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
const ABOUT = 'Your Finance Helper. Tap a block or type "coffee 35". Sent while your PC is off? It is saved for 24 hours and logged when the app opens.';

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
          await sleep(15000);
          if (inbox.size) onUpdates([...inbox.values()]);
          continue;
        }
        if (cfg?.chatId) setMenu();
        // A "load now" while waiting cuts the long wait short.
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        poll = ac;
        let updates;
        try {
          updates = await call('getUpdates', { offset, timeout: waiters.length ? 0 : 25, allowed_updates: ['message', 'callback_query'] }, undefined, ac?.signal);
        } catch (e) {
          if (ac?.signal.aborted) continue;
          throw e;
        } finally { poll = null; }
        if (my !== gen) break;
        lastError = '';
        lastCheck = Date.now();
        backoff = 2000;
        if (updates.length) await handle(updates);
        settle(updates.length);
      } catch (e) {
        if (!running || my !== gen) break;
        lastError = e.code === 409 ? 'Another program is reading this bot. Close it, or use a new bot just for Finance Helper.' : e.code === 401 ? 'The bot token is no longer valid.' : e.message;
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
    status: () => ({ connected: !!cfg?.token, botName: cfg?.botName || '', linked: !!cfg?.chatId, userName: cfg?.userName || '', error: lastError, pairing: pairCode, lastCheck }),
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
      const next = { token: t, botName: me.username, chatId: null };
      store.write(next); // throws when the computer can't store it safely
      stop();
      cfg = next;
      inbox.clear();
      offset = 0;
      menuSet = false;
      start();
      return { botName: me.username };
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
        offset = Math.max(offset, id + 1);
      }
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
    async disconnect() {
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
