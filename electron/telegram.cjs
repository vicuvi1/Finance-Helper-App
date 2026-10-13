// Telegram bot for the desktop app, without any server: this process asks
// Telegram for new messages (long polling) and sends the bot's replies and
// reminders. The bot token and your chat are encrypted with the operating
// system's key store (safeStorage), like the Binance key. Only the chat that
// linked itself with the one-time code is listened to.
//
// A message is confirmed to Telegram only after the app has handled it
// (ack), so nothing is lost while the app is locked or busy; Telegram keeps
// unconfirmed messages for 24 hours, so ones sent while the PC was off are
// logged at the next start.
//
// "Always on" (optional): a small Google Apps Script in the user's own Google
// account (relay.gs) reads the bot every minute while this app is closed,
// answers, and keeps the messages; this app collects them from it ("pull")
// and confirms them ("ack"). Every call carries a key only this app knows.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const API = process.env.FH_TG_API || 'https://api.telegram.org';

// The "/" menu in Telegram and the text shown before you press Start.
const COMMANDS = [
  ['today', 'Today: what you spent'],
  ['month', 'This month so far'],
  ['balance', 'All accounts'],
  ['last', 'Last records'],
  ['undo', 'Remove the last record'],
  ['blocks', 'Your quick buttons'],
  ['help', 'How to log'],
];
const ABOUT = 'Your Finance Helper. Tap a block or type "coffee 35". Sent while your PC is off? It is saved and logged when the app opens.';
const RELAY_URL = /^https:\/\/script\.google\.com\/(a\/[\w.-]+\/)?macros\/s\/[\w-]+\/exec$/;
const RELAY_EVERY = 15000; // how often an open app collects from the relay
// Your own bot server (server/finance-bot.mjs): https anywhere, or plain http
// only inside a private network (Tailscale, home network, this computer).
const SERVER_URL = /^(https:\/\/[\w.-]+(:\d+)?|http:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|100\.\d+\.\d+\.\d+|[\w-]+|[\w.-]+\.ts\.net)(:\d+)?)(\/[\w./-]*)?$/;

function createTelegram({ app, net, safeStorage, onUpdates = () => {}, onEvent = () => {}, storage }) {
  const file = () => path.join(app.getPath('userData'), 'telegram.bin');
  // Tests pass their own storage; the app uses the OS key store.
  const store = storage || {
    read() {
      try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file()))); } catch { return null; }
    },
    write(obj) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no secure key storage available.');
      fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify(obj)), { mode: 0o600 });
    },
    remove() { try { fs.unlinkSync(file()); } catch { /* already gone */ } },
  };

  let cfg = store.read(); // { token, botName, chatId }
  let running = false;
  let offset = 0;
  let pairCode = null;
  const inbox = new Map(); // update_id -> update, handed to the app, not yet acked
  let wake = null;
  let lastError = '';
  let gen = 0; // a new start() ends any older loop
  let poll = null; // the running getUpdates request, to cut it short
  let waiters = []; // "load now" calls waiting for the next check
  let lastCheck = 0;
  let menuSet = false;
  let lastCode = ''; // why it isn't working: token, conflict, network, telegram
  let relayInfo = {}; // what the relay said last: lastRun, waiting, trigger, lastError
  let relayError = '';
  let lastPull = 0;
  const relayIds = new Set(); // updates that came from the relay (ack them there)
  let relayAcks = new Set(); // handled, still to confirm to the relay
  let relayOkAt = 0;
  const handled = new Set(); // recently handled ids, so the relay can't hand one over twice
  let serverAcks = new Set(); // handled, still to confirm to your server
  let serverInfo = {};
  let serverError = '';
  let serverOkAt = 0;

  // Your own bot server: JSON over https, the key in a header.
  async function serverCall(body, { url = cfg?.server?.url, key = cfg?.server?.key, signal } = {}) {
    const r = await net.fetch(`${String(url).replace(/\/+$/, '')}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    let j = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (r.status === 401) throw new Error('The server says the key is wrong. Copy it again (docker compose logs finance-bot).');
    if (!j) throw new Error(`Your bot server didn't answer (HTTP ${r.status}).`);
    if (!j.ok) throw new Error(j.error || 'Your bot server said no.');
    return j;
  }
  const serverFields = (j) => ({ lastTick: j.lastTick || 0, waiting: j.waiting || 0, snapshotAt: j.snapshotAt || 0, lastError: j.lastError || '' });

  async function flushServerAcks() {
    if (!serverAcks.size) return;
    const ids = [...serverAcks];
    await serverCall({ a: 'ack', ids });
    serverAcks = new Set([...serverAcks].filter((x) => !ids.includes(x)));
  }

  // With a server, it is the only reader of the bot: a long "pull" that
  // returns the moment a message arrives.
  async function pullServer() {
    await flushServerAcks();
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    poll = ac;
    let j;
    try {
      j = await serverCall({ a: 'pull', wait: waiters.length || serverAcks.size ? 0 : 25, skip: [...inbox.keys()] }, { signal: ac?.signal });
    } catch (e) {
      if (ac?.signal.aborted) return null; // cut short (an ack or "load now"): ask again
      throw e;
    } finally { poll = null; }
    serverInfo = serverFields(j);
    serverError = '';
    serverOkAt = Date.now();
    const fresh = (j.updates || []).filter((u) => Number.isInteger(u.update_id) && !inbox.has(u.update_id) && !serverAcks.has(u.update_id) && !handled.has(u.update_id));
    if (fresh.length) await handle(fresh);
    return fresh.length;
  }

  // The relay is a Google web app: answers JSON, after a redirect.
  async function relayCall(params, { post = false, url = cfg?.relay?.url } = {}) {
    const q = new URLSearchParams(post ? {} : params).toString();
    const r = await net.fetch(post ? url : `${url}?${q}`, post
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(params) }
      : { method: 'GET' });
    let j = null;
    try { j = JSON.parse(await r.text()); } catch { /* not JSON */ }
    if (!j) throw new Error('The Google script didn\'t answer. Check it is deployed as a Web app with access "Anyone".');
    if (!j.ok) throw new Error(j.error || 'The Google script said no.');
    return j;
  }

  const relayFields = (j) => ({ lastTick: j.lastTick || 0, lastRun: j.lastRun || 0, waiting: j.waiting || 0, trigger: !!j.trigger, lastError: j.lastError || '' });

  // Collect what the relay kept while this app was closed.
  async function pullRelay(force = false) {
    if (!cfg?.relay || !cfg.chatId || (!force && Date.now() - lastPull < RELAY_EVERY)) return 0;
    lastPull = Date.now();
    try {
      if (relayAcks.size) {
        const ids = [...relayAcks];
        await relayCall({ k: cfg.relay.key, a: 'ack', ids: ids.join(',') });
        relayAcks = new Set([...relayAcks].filter((x) => !ids.includes(x)));
      }
      const j = await relayCall({ k: cfg.relay.key, a: 'pull', from: offset });
      relayInfo = relayFields(j);
      relayError = '';
      relayOkAt = Date.now();
      const fresh = (j.updates || []).filter((u) => Number.isInteger(u.update_id) && !inbox.has(u.update_id) && !relayAcks.has(u.update_id) && !handled.has(u.update_id));
      for (const u of fresh) relayIds.add(u.update_id);
      if (fresh.length) await handle(fresh);
      return fresh.length;
    } catch (e) {
      relayError = e.message;
      return 0;
    }
  }

  async function call(method, params = {}, token = cfg?.token, signal) {
    const r = await net.fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      ...(signal ? { signal } : {}),
    });
    let json = null;
    try { json = await r.json(); } catch { /* not JSON */ }
    if (!json?.ok) {
      const e = new Error(json?.description || `Telegram error (HTTP ${r.status})`);
      e.code = json?.error_code || r.status;
      throw e;
    }
    return json.result;
  }

  const sleep = (ms) => new Promise((res) => { wake = res; setTimeout(res, ms); });
  const settle = (n) => { const w = waiters; waiters = []; for (const res of w) res(n); };

  // Once per run: the command menu and the bot's description (best effort).
  async function setMenu() {
    if (menuSet) return;
    menuSet = true;
    await call('setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) }).catch(() => {});
    await call('setMyShortDescription', { short_description: ABOUT.slice(0, 120) }).catch(() => {});
    await call('setMyDescription', { description: ABOUT }).catch(() => {});
  }

  async function handle(updates) {
    const forward = [];
    for (const u of updates) {
      const msg = u.message || u.callback_query?.message;
      const chat = msg?.chat?.id;
      const text = (u.message?.text || '').trim();
      if (!cfg.chatId) {
        // Linking: "/start 123456" (what the t.me link sends) or just the code.
        const code = text.replace(/^\/start\s*/, '');
        if (pairCode && code === pairCode && u.message?.chat?.type === 'private') {
          const next = { ...cfg, chatId: chat, userName: u.message.from?.first_name || '' };
          try {
            store.write(next); // saved first: never "linked" only in memory
            cfg = next;
            pairCode = null;
            onEvent({ type: 'linked', name: cfg.userName });
          } catch (e) {
            onEvent({ type: 'error', message: e.message });
          }
        } else if (chat && u.message) {
          await call('sendMessage', { chat_id: chat, text: 'Open Finance Helper → Settings → Telegram and send the code shown there.' }).catch(() => {});
        }
        offset = Math.max(offset, u.update_id + 1);
      } else if (chat !== cfg.chatId) {
        offset = Math.max(offset, u.update_id + 1); // someone else: ignored
      } else {
        inbox.set(u.update_id, u);
        forward.push(u);
      }
    }
    if (forward.length) onUpdates(forward);
  }

  async function loop(my) {
    let backoff = 2000;
    while (running && my === gen) {
      try {
        if (inbox.size) {
          // Waiting for the app to handle what it has; hand it over again
          // now and then (e.g. after the app is unlocked).
          settle(inbox.size);
          // Keep telling the relay the app is open (e.g. while it is locked),
          // so it doesn't start answering in its place.
          if (cfg?.server) await flushServerAcks().catch(() => {});
          else await pullRelay();
          await sleep(15000);
          if (inbox.size) onUpdates([...inbox.values()]);
          continue;
        }
        if (cfg?.chatId) setMenu();
        if (cfg?.server && cfg.chatId) {
          const n = await pullServer();
          if (my !== gen) break;
          if (n === null) continue;
          lastError = '';
          lastCode = '';
          lastCheck = Date.now();
          backoff = 2000;
          settle(n);
          continue;
        }
        const fromRelay = await pullRelay(waiters.length > 0);
        if (inbox.size && fromRelay) { settle(fromRelay); continue; }
        // A "load now" while waiting cuts the long wait short.
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        poll = ac;
        let updates;
        try {
          // With the relay on, wait less so it is collected from every ~15 s.
          updates = await call('getUpdates', { offset, timeout: waiters.length ? 0 : cfg?.relay ? 14 : 25, allowed_updates: ['message', 'callback_query'] }, undefined, ac?.signal);
        } catch (e) {
          if (ac?.signal.aborted) continue;
          throw e;
        } finally { poll = null; }
        if (my !== gen) break;
        lastError = '';
        lastCode = '';
        lastCheck = Date.now();
        backoff = 2000;
        if (updates.length) await handle(updates);
        settle(updates.length);
      } catch (e) {
        if (!running || my !== gen) break;
        // The relay read Telegram at the same moment (right after the app
        // opened): not a problem, it keeps those messages for the app.
        if (e.code === 409 && cfg?.relay) { await sleep(1500); continue; }
        if (cfg?.server) {
          serverError = e.message;
          lastCode = 'server';
          lastError = `Your bot server doesn't answer (${e.message}). Your messages wait there safely; trying again…`;
          onEvent({ type: 'error', message: lastError });
          settle(-1);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 60000);
          continue;
        }
        lastCode = e.code === 401 || e.code === 404 ? 'token' : e.code === 409 ? 'conflict' : e.code ? 'telegram' : 'network';
        lastError = lastCode === 'token' ? 'Telegram doesn\'t accept the bot token any more (it was revoked or changed in @BotFather). Paste the new token in Settings → Telegram.'
          : lastCode === 'conflict' ? 'Another program (or a second copy of this app) is reading this bot. Close it; only one app can read a bot.'
            : lastCode === 'network' ? 'No connection to Telegram (internet?). Trying again…' : e.message;
        onEvent({ type: 'error', message: lastError });
        settle(-1);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 5 * 60000);
      }
    }
  }

  function start() {
    if (running || !cfg?.token) return;
    running = true;
    loop(++gen);
  }

  function stop() {
    running = false;
    wake?.();
  }

  return {
    start,
    stop,
    status: () => ({ connected: !!cfg?.token, botName: cfg?.botName || '', linked: !!cfg?.chatId, userName: cfg?.userName || '', error: lastError, errorCode: lastCode, running, pairing: pairCode, lastCheck,
      relay: cfg?.relay ? { on: true, lastPull, okAt: relayOkAt, error: relayError, ...relayInfo } : { on: false },
      server: cfg?.server ? { on: true, url: cfg.server.url, okAt: serverOkAt, error: serverError, ...serverInfo } : { on: false } }),
    // "Load from Telegram": check right now. Resolves with how many messages
    // came (or are waiting for the app), -1 on an error.
    loadNow() {
      if (!cfg?.token) return Promise.resolve(-1);
      return new Promise((res) => {
        waiters.push(res);
        setTimeout(() => res(-1), 20000);
        if (!running) start();
        if (inbox.size) onUpdates([...inbox.values()]);
        poll?.abort();
        wake?.();
      });
    },
    async connect(token) {
      const t = String(token || '').trim();
      if (!/^\d{5,}:[\w-]{30,}$/.test(t)) throw new Error('That doesn\'t look like a bot token. It looks like 123456789:AA… (from @BotFather).');
      const me = await call('getMe', {}, t);
      await call('deleteWebhook', {}, t).catch(() => {});
      // A new token for the same bot (after revoking the old one): keep the
      // linked chat, nothing to link again.
      const same = cfg?.chatId && cfg.token && t.split(':')[0] === cfg.token.split(':')[0];
      const next = { token: t, botName: me.username, chatId: same ? cfg.chatId : null, ...(same ? { userName: cfg.userName || '', relay: cfg.relay, relayKey: cfg.relayKey, server: cfg.server } : {}) };
      store.write(next); // throws when the computer can't store it safely
      stop();
      cfg = next;
      inbox.clear();
      offset = 0;
      menuSet = false;
      lastError = '';
      lastCode = '';
      start();
      // The always-on script needs the new token too.
      if (same && cfg.relay) await relayCall({ k: cfg.relay.key, a: 'setup', token: t, chat: cfg.chatId, from: offset }, { post: true }).catch((e) => { relayError = e.message; });
      if (same && cfg.server) await serverCall({ a: 'setup', token: t, chat: cfg.chatId }).catch((e) => { serverError = e.message; });
      return { botName: me.username, kept: !!same };
    },
    // A fresh one-time code to link your Telegram account.
    pair() {
      pairCode = String(crypto.randomInt(100000, 1000000));
      return { code: pairCode, link: cfg?.botName ? `https://t.me/${cfg.botName}?start=${pairCode}` : null };
    },
    // The app handled these updates: confirm them to Telegram.
    ack(ids) {
      for (const id of ids || []) {
        inbox.delete(id);
        handled.add(id);
        if (cfg?.server) { serverAcks.add(id); continue; } // kept by your server: confirm it there
        if (relayIds.delete(id)) relayAcks.add(id); // kept by the relay: confirm it there
        else {
          offset = Math.max(offset, id + 1);
          if (cfg?.relay) relayAcks.add(id); // in case the relay kept a copy too
        }
      }
      if (handled.size > 500) for (const id of [...handled].slice(0, handled.size - 500)) handled.delete(id);
      if (relayAcks.size) { lastPull = 0; wake?.(); }
      if (serverAcks.size) poll?.abort(); // confirm now, then wait again
      if (!inbox.size) wake?.();
      return true;
    },
    async send(text, extra = {}) {
      if (!cfg?.chatId) throw new Error('No Telegram chat linked yet.');
      return call('sendMessage', { chat_id: cfg.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    },
    async edit(messageId, text, extra = {}) {
      return call('editMessageText', { chat_id: cfg.chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
    },
    async answer(callbackId, text = '') {
      return call('answerCallbackQuery', { callback_query_id: callbackId, text }).catch(() => {});
    },
    // Always on: the Google script, with this app's key written into it.
    relayScript() {
      if (!cfg?.token) throw new Error('Connect the bot first.');
      if (!cfg.relayKey) {
        cfg = { ...cfg, relayKey: crypto.randomBytes(24).toString('base64url') };
        store.write(cfg);
      }
      const src = fs.readFileSync(path.join(__dirname, 'relay.gs'), 'utf8');
      return src.replace("'__KEY__'", `'${cfg.relayKey}'`);
    },
    async relayConnect(url) {
      const u = String(url || '').trim();
      if (!cfg?.chatId) throw new Error('Link your Telegram first.');
      if (!RELAY_URL.test(u) && !(process.env.FH_RELAY_ANY_URL === '1' && /^http:\/\/127\.0\.0\.1:\d+\//.test(u))) {
        throw new Error('Paste the Web app URL: it looks like https://script.google.com/macros/s/…/exec');
      }
      if (!cfg.relayKey) throw new Error('Copy the script first (it carries this app\'s key).');
      const j = await relayCall({ k: cfg.relayKey, a: 'setup', token: cfg.token, chat: cfg.chatId, from: offset }, { post: true, url: u });
      cfg = { ...cfg, relay: { url: u, key: cfg.relayKey } };
      store.write(cfg);
      relayInfo = relayFields(j);
      relayError = '';
      relayOkAt = Date.now();
      lastPull = 0;
      wake?.();
      return { trigger: !!j.trigger, triggerError: j.triggerError || '' };
    },
    async relayOff() {
      if (!cfg?.relay) return true;
      await relayCall({ k: cfg.relay.key, a: 'off' }).catch(() => {});
      const { relay, ...rest } = cfg;
      cfg = rest;
      store.write(cfg);
      relayInfo = {};
      relayError = '';
      return true;
    },
    // Your own server: it becomes the bot's only reader.
    async serverConnect(url, key) {
      const u = String(url || '').trim().replace(/\/+$/, '');
      const k = String(key || '').trim();
      if (!cfg?.chatId) throw new Error('Link your Telegram first.');
      if (!SERVER_URL.test(u)) throw new Error('Use https://your-domain, or http:// only for a private address (Tailscale, e.g. http://my-server:8787).');
      if (k.length < 16) throw new Error('Paste the key the server printed (docker compose logs finance-bot).');
      // Stop reading Telegram here first: from now on only the server reads it.
      const wasRunning = running;
      stop();
      poll?.abort();
      let j;
      try {
        j = await serverCall({ a: 'setup', token: cfg.token, chat: cfg.chatId, from: offset }, { url: u, key: k });
      } catch (e) {
        if (wasRunning) start();
        throw e;
      }
      if (cfg.relay) await relayCall({ k: cfg.relay.key, a: 'off' }).catch(() => {});
      const { relay, ...rest } = cfg;
      cfg = { ...rest, server: { url: u, key: k } };
      store.write(cfg);
      relayInfo = {};
      serverInfo = serverFields(j);
      serverError = '';
      serverOkAt = Date.now();
      if (wasRunning) start();
      return { ok: true };
    },
    async serverOff() {
      if (!cfg?.server) return true;
      await serverCall({ a: 'off' }).catch(() => {});
      const { server, ...rest } = cfg;
      cfg = rest;
      store.write(cfg);
      serverInfo = {};
      serverError = '';
      poll?.abort();
      wake?.();
      return true;
    },
    // A short summary of your numbers, so the bot can answer while the PC is off.
    async snapshot(snap) {
      if (!cfg?.server) return false;
      await serverCall({ a: 'snapshot', snapshot: snap });
      return true;
    },
    async disconnect() {
      if (cfg?.server) await serverCall({ a: 'off' }).catch(() => {});
      if (cfg?.relay) await relayCall({ k: cfg.relay.key, a: 'off' }).catch(() => {});
      stop();
      store.remove();
      cfg = null;
      inbox.clear();
      offset = 0;
      return true;
    },
  };
}

module.exports = { createTelegram };
