// Finance Helper bot server: keeps your Telegram bot on 24/7 on your own
// server (next to Hermes), and gives the app a live link to it.
//
// - It is the ONLY program that reads the bot. Messages wait here until the
//   app has logged them (the app confirms each one: "ack").
// - While the app is open it holds a long request ("pull ... wait") that this
//   server answers the moment a message arrives: the app logs it within a
//   second and replies itself, with the full numbers.
// - While the PC is off it answers at once: "Saved, logged when the app
//   opens", and /today, /balance, /month, /last from the last snapshot the
//   app sent (marked with its time).
//
// Node 20+, no packages. Settings (environment):
//   FH_KEY       the app's key (made on first start and printed if empty)
//   PORT         default 8787
//   DATA_DIR     default ./data (token, chat, waiting messages, snapshot)
//   FH_TG_API    default https://api.telegram.org (tests use a fake)
//
// API: POST /api with header "Authorization: Bearer <key>" and a JSON body
// { a: 'setup' | 'pull' | 'ack' | 'snapshot' | 'status' | 'off', ... }.
// GET /health answers "ok" (no key, no data) for uptime checks.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = process.env.FH_TG_API || 'https://api.telegram.org';
const DATA = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA, 'state.json');
const LIVE_MS = Number(process.env.FH_LIVE_MS) || 20000; // the app pulled this recently: it is open
const FALLBACK_MS = 45000; // the app was open but didn't log it in time: answer anyway
const MAX_KEEP = 2000;

fs.mkdirSync(DATA, { recursive: true });

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
let st = { offset: 0, queue: [], ...load() };
function save() {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
if (process.env.FH_KEY) st.key = process.env.FH_KEY;
if (!st.key) {
  st.key = crypto.randomBytes(24).toString('base64url');
  save();
  console.log(`\n  Finance Helper bot server: your key (paste it in the app):\n\n    ${st.key}\n`);
}

let lastPull = 0;
let lastTick = 0;
let lastError = '';
const waiting = new Set(); // open "pull" requests: { res, timer }

async function tg(method, params = {}, signal) {
  const r = await fetch(`${API}/bot${st.token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal,
  });
  const j = await r.json().catch(() => null);
  if (!j?.ok) { const e = new Error(j?.description || `Telegram HTTP ${r.status}`); e.code = j?.error_code || r.status; throw e; }
  return j.result;
}

// Only what the app needs from an update.
function slim(u) {
  const out = { update_id: u.update_id };
  if (u.message) {
    const m = u.message;
    out.message = { message_id: m.message_id, date: m.date, text: m.text || '', chat: { id: m.chat.id, type: m.chat.type }, from: { first_name: m.from?.first_name || '' } };
  }
  if (u.callback_query) {
    const q = u.callback_query;
    out.callback_query = { id: q.id, data: q.data, message: q.message ? { message_id: q.message.message_id, chat: { id: q.message.chat.id } } : null };
  }
  return out;
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const ASKS = [
  [/^(\/today|📊)/, 'today'], [/^(\/balance|💰)/, 'balance'], [/^(\/month|📅)/, 'month'], [/^(\/last|🧾)/, 'last'],
  [/^(\/safe|🟢)/, 'safe'], [/^(\/goals|🎯)/, 'goals'], [/^(\/rates|💵)/, 'rates'],
];
const at = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Chisinau' });

// What the bot says while the app is closed.
function offlineReply(text) {
  const snap = st.snapshot;
  for (const [re, key] of ASKS) {
    if (re.test(text)) {
      return snap?.[key] ? `${snap[key]}\n\n<i>As of ${at(snap.at)}: your PC is off. New records show up once Finance Helper opens.</i>`
        : '📴 Your PC is off, so I can\'t see your numbers right now. Ask again when Finance Helper is open.';
    }
  }
  if (/^\//.test(text) || /^❓/.test(text)) return '📴 Your PC is off. Records you send are saved and logged when Finance Helper opens.';
  return `📝 Saved: <b>${esc(text)}</b>. It will be logged on today's date as soon as Finance Helper opens.${snap?.safe ? `\n\n${snap.safe}\n<i>(as of ${at(snap.at)})</i>` : ''}`;
}

async function answerOffline(item) {
  if (item.replied) return;
  item.replied = true;
  try {
    if (item.callback_query) await tg('answerCallbackQuery', { callback_query_id: item.callback_query.id, text: 'Saved. It is applied when Finance Helper opens.' });
    else if (item.message) {
      const r = await tg('sendMessage', { chat_id: st.chat, text: offlineReply(item.message.text || ''), parse_mode: 'HTML', reply_to_message_id: item.message.message_id });
      item.relayReply = r.message_id;
    }
  } catch { /* kept either way */ }
  save();
}

function wakePulls() {
  for (const w of waiting) { clearTimeout(w.timer); w.done(); }
  waiting.clear();
}

// The one reader of the bot: long-polls Telegram forever.
async function readLoop() {
  let backoff = 2000;
  for (;;) {
    if (!st.token || !st.chat) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    try {
      const updates = await tg('getUpdates', { offset: st.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      lastTick = Date.now();
      lastError = '';
      backoff = 2000;
      let fresh = 0;
      for (const u of updates) {
        st.offset = Math.max(st.offset, u.update_id + 1);
        const m = u.message || u.callback_query?.message;
        if (!m || m.chat.id !== st.chat) continue; // only your chat
        if (st.queue.some((x) => x.update_id === u.update_id)) continue;
        const item = { ...slim(u), at: Date.now() };
        st.queue.push(item);
        fresh++;
        if (Date.now() - lastPull > LIVE_MS) await answerOffline(item); // the app is closed
      }
      if (st.queue.length > MAX_KEEP) st.queue = st.queue.slice(-MAX_KEEP);
      if (updates.length) save();
      if (fresh) wakePulls();
    } catch (e) {
      lastError = e.message;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

// The app was open but hasn't logged a message for a while (crashed, locked
// for long, lost the connection): answer it so you aren't left waiting.
setInterval(() => {
  for (const item of st.queue) if (!item.replied && Date.now() - item.at > FALLBACK_MS) answerOffline(item);
}, 10000).unref();

const status = () => ({
  ok: true, version: 2, server: true, configured: !!st.token, linked: !!st.chat,
  lastTick, lastError, waiting: st.queue.length, snapshotAt: st.snapshot?.at || 0,
});

async function api(q) {
  if (q.a === 'setup') {
    if (!q.token || !q.chat) return { ok: false, error: 'Missing bot token or chat.' };
    const prev = st.token;
    st.token = String(q.token);
    try { await tg('getMe'); await tg('deleteWebhook'); } catch (e) { st.token = prev; return { ok: false, error: `Telegram: ${e.message}` }; }
    if (st.chat !== Number(q.chat)) st.queue = [];
    st.chat = Number(q.chat);
    // Everything the app already handled is never read again.
    if (Number.isInteger(q.from) && q.from > st.offset) st.offset = q.from;
    lastPull = Date.now();
    save();
    return status();
  }
  if (q.a === 'pull') {
    lastPull = Date.now();
    const pending = () => st.queue.filter((x) => !(q.skip || []).includes(x.update_id));
    const wait = Math.min(Math.max(Number(q.wait) || 0, 0), 25) * 1000;
    if (!pending().length && wait) {
      await new Promise((done) => {
        const w = { done, timer: setTimeout(() => { waiting.delete(w); done(); }, wait) };
        waiting.add(w);
      });
      lastPull = Date.now();
    }
    return { ...status(), updates: pending().map(({ at: _a, replied: _r, ...u }) => u) };
  }
  if (q.a === 'ack') {
    const ids = new Set((q.ids || []).map(Number));
    st.queue = st.queue.filter((x) => !ids.has(x.update_id));
    save();
    return { ok: true };
  }
  if (q.a === 'snapshot') {
    const s = q.snapshot || {};
    const pick = (k) => (typeof s[k] === 'string' ? s[k].slice(0, 3500) : '');
    st.snapshot = { at: Date.now(), today: pick('today'), balance: pick('balance'), month: pick('month'), last: pick('last'), safe: pick('safe'), goals: pick('goals'), rates: pick('rates') };
    save();
    return { ok: true };
  }
  if (q.a === 'status') return status();
  if (q.a === 'off') {
    st = { key: st.key, offset: 0, queue: [] };
    save();
    wakePulls();
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}

const sameKey = (h) => {
  const a = Buffer.from(String(h || '').replace(/^Bearer\s+/i, ''));
  const b = Buffer.from(st.key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (req.method !== 'POST' || req.url !== '/api') return send(404, { ok: false, error: 'Not found.' });
  if (!sameKey(req.headers.authorization)) return send(401, { ok: false, error: 'Wrong key: copy it again from the server (docker logs).' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
  req.on('end', async () => {
    let q = {};
    try { q = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, error: 'Not JSON.' }); }
    try { send(200, await api(q)); } catch (e) { send(500, { ok: false, error: e.message }); }
  });
});

server.requestTimeout = 60000;
server.listen(Number(process.env.PORT) || 8787, () => console.log(`Finance Helper bot server on port ${server.address().port}`));
readLoop();
