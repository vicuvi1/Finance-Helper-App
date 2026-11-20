// The always-on Telegram bot on the server (api/telegram.mjs + api/_tgbot.mjs), against the
// real server code, a local stand-in for Turso and a fake Telegram. All data made up.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startFakeTurso } from '../e2e/faketurso.mjs';
import { startDevServer } from '../e2e/devserver.mjs';
import { createCloud } from '../js/cloud.js';
import { normalizeState, SCHEMA_VERSION } from '../js/model.js';
import { moneyDay, webhookSecret } from '../api/_tgbot.mjs';
import { config } from '../api/_lib.mjs';

const SETUP = 'test-setup-key';
const PIN = '2468';
const CHAT = '777000';
const SECRET = 'test-session-secret';
let turso;
let server;
let fakeTg;
const sent = []; // what the bot sent to Telegram
let hook = { url: '' };

function startFakeTelegram() {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const method = req.url.split('/').pop();
      const p = body ? JSON.parse(body) : {};
      sent.push({ method, p });
      const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
      if (method === 'getMe') return ok({ username: 'madeup_money_bot' });
      if (method === 'setWebhook') { hook = { url: p.url, secret: p.secret_token }; return ok(true); }
      if (method === 'deleteWebhook') { hook = { url: '' }; return ok(true); }
      if (method === 'getWebhookInfo') return ok({ url: hook.url, pending_update_count: 0 });
      return ok({ message_id: 1 });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

before(async () => {
  turso = await startFakeTurso();
  fakeTg = await startFakeTelegram();
  server = await startDevServer({ env: { TURSO_URL: turso.url, TURSO_TOKEN: turso.token, CRON_SECRET: SETUP, SESSION_SECRET: SECRET, FINANCE_BOT_TOKEN: '123456:made-up-token', TELEGRAM_CHAT_ID: CHAT, FH_TG_API: fakeTg.url } });
});
after(async () => { await server?.close(); await turso?.close(); await fakeTg?.close(); });

const post = (path, body, headers = {}) => fetch(`${server.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const transport = (path, body, token) => post(path, body, token ? { Authorization: `Bearer ${token}` } : {});
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function app(initial) {
  let state = normalizeState({ version: SCHEMA_VERSION, tx: [], ...initial });
  const cloud = createCloud({ transport, store: memStore(), app: { getState: () => state, setState: (s) => { state = s; } } });
  return { cloud, get state() { return state; } };
}
const hookHeaders = () => ({ 'X-Telegram-Bot-Api-Secret-Token': webhookSecret(config({ TURSO_URL: turso.url, TURSO_TOKEN: turso.token, SESSION_SECRET: SECRET })) });
let uid = 1000;
const message = (text, chat = CHAT, date = Math.floor(Date.now() / 1000)) => ({ update_id: ++uid, message: { message_id: uid, date, chat: { id: Number(chat) }, from: { id: Number(chat) }, text } });

let session;
test('the app turns the bot on with its session; status shows it', async () => {
  assert.equal((await post('/api/telegram', { op: 'status' })).status, 401, 'needs a session');
  session = (await transport('/api/login', { setup: SETUP, pin: PIN })).json.session;
  const desk = app({ tx: [{ id: 'd1', date: '2026-11-01', type: 'expense', amount: 4200, account: 'cash', category: 'food', note: 'made-up lunch', createdAt: 1, updatedAt: 1 }] });
  await desk.cloud.signIn(PIN);
  assert.equal((await desk.cloud.sync()).ok, true);
  const on = await transport('/api/telegram', { op: 'on' }, session);
  assert.equal(on.status, 200);
  assert.equal(on.json.on, true);
  assert.equal(on.json.bot, 'madeup_money_bot');
  assert.match(hook.url, /\/api\/telegram$/);
});

test('only Telegram with the secret is heard, and only your chat', async () => {
  assert.equal((await post('/api/telegram', message('coffee 35'), { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' })).status, 401);
  sent.length = 0;
  assert.equal((await post('/api/telegram', message('coffee 35', '999'), hookHeaders())).status, 200);
  assert.equal(sent.filter((x) => x.method === 'sendMessage').length, 0, 'a stranger gets nothing');
});

test('a message becomes a record in the synced copy; the apps get it; Telegram retries are one record', async () => {
  sent.length = 0;
  const m = message('taxi 45');
  assert.equal((await post('/api/telegram', m, hookHeaders())).status, 200);
  assert.equal((await post('/api/telegram', m, hookHeaders())).status, 200); // Telegram sent it twice
  const reply = sent.find((x) => x.method === 'sendMessage');
  assert.match(reply.p.text, /45/);
  assert.equal(reply.p.reply_markup.inline_keyboard[0][0].callback_data, `undo:tg-${m.update_id}`);
  const web = app();
  await web.cloud.signIn(PIN);
  assert.equal((await web.cloud.sync()).ok, true);
  const got = web.state.tx.filter((t) => t.id === `tg-${m.update_id}`);
  assert.equal(got.length, 1);
  assert.equal(got[0].amount, 4500);
  assert.equal(got[0].source, 'telegram');
  assert.equal(got[0].date, moneyDay(m.message.date * 1000));
  assert.ok(web.state.tx.some((t) => t.note === 'made-up lunch'), 'what was there stays');
});

test('"yesterday" goes on yesterday; Undo removes it everywhere', async () => {
  const m = message('yesterday 120 made-up bread');
  await post('/api/telegram', m, hookHeaders());
  const web = app();
  await web.cloud.signIn(PIN);
  await web.cloud.sync();
  const t = web.state.tx.find((x) => x.id === `tg-${m.update_id}`);
  const today = moneyDay(m.message.date * 1000);
  assert.ok(t.date < today);
  sent.length = 0;
  await post('/api/telegram', { update_id: ++uid, callback_query: { id: 'cq1', data: `undo:${t.id}`, from: { id: Number(CHAT) }, message: { message_id: 5, chat: { id: Number(CHAT) } } } }, hookHeaders());
  assert.equal(sent.find((x) => x.method === 'answerCallbackQuery').p.text, 'Removed');
  await web.cloud.sync();
  assert.equal(web.state.tx.some((x) => x.id === t.id), false);
  assert.ok(web.state.deleted[t.id], 'removed with a deletion marker, so no device brings it back');
});

test('commands answer from the synced copy; a message without an amount gets help', async () => {
  sent.length = 0;
  await post('/api/telegram', message('/balance'), hookHeaders());
  await post('/api/telegram', message('hello'), hookHeaders());
  const texts = sent.filter((x) => x.method === 'sendMessage').map((x) => x.p.text);
  assert.match(texts[0], /All my money/);
  assert.match(texts[1], /amount/i);
});

test('the app turns it off', async () => {
  const off = await transport('/api/telegram', { op: 'off' }, session);
  assert.equal(off.status, 200);
  assert.equal(off.json.on, false);
});
