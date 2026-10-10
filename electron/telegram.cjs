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

  async function call(method, params = {}, token = cfg?.token) {
    const r = await net.fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
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
          await sleep(15000);
          if (inbox.size) onUpdates([...inbox.values()]);
          continue;
        }
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        if (my !== gen) break;
        lastError = '';
        backoff = 2000;
        if (updates.length) await handle(updates);
      } catch (e) {
        if (!running || my !== gen) break;
        lastError = e.code === 409 ? 'Another program is reading this bot. Close it, or use a new bot just for Finance Helper.' : e.code === 401 ? 'The bot token is no longer valid.' : e.message;
        onEvent({ type: 'error', message: lastError });
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
    status: () => ({ connected: !!cfg?.token, botName: cfg?.botName || '', linked: !!cfg?.chatId, userName: cfg?.userName || '', error: lastError, pairing: pairCode }),
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
