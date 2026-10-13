// The bot server (server/finance-bot.mjs) against a fake Telegram: it answers
// while the app is closed, keeps messages until the app confirms them, hands
// them over the moment they arrive while the app is open, and only obeys the
// app's key. Then the desktop bot module (electron/telegram.cjs) using it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fakeTelegram } from '../e2e/faketelegram.mjs';

const KEY = 'test-key-0123456789abcdef';
const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CHAT = 4242;
let tg; let proc; let url; let data;

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const api = async (body, key = KEY) => {
  const r = await fetch(`${url}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};

before(async () => {
  tg = fakeTelegram();
  await new Promise((r) => tg.server.listen(0, '127.0.0.1', r));
  data = mkdtempSync(join(tmpdir(), 'fh-bot-'));
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server/finance-bot.mjs'], { env: { ...process.env, PORT: String(port), DATA_DIR: data, FH_KEY: KEY, FH_TG_API: tg.url(), FH_LIVE_MS: '1500', TZ: 'UTC' }, stdio: 'ignore' });
  assert.ok(await until(async () => (await fetch(`${url}/health`).catch(() => null))?.ok));
});

after(() => {
  proc?.kill();
  tg?.server.close();
  rmSync(data, { recursive: true, force: true });
});

test('bot server: obeys only the key; set up with the bot and your chat', async () => {
  assert.equal((await api({ a: 'status' }, 'wrong-key-0123456789abc')).status, 401);
  const s = await api({ a: 'setup', token: TOKEN, chat: CHAT });
  assert.equal(s.ok, true);
  assert.equal(s.linked, true);
});

test('bot server: PC off → answers at once, keeps the message; snapshot answers /today; the app collects and confirms', async () => {
  await new Promise((r) => setTimeout(r, 1700)); // the app hasn't pulled for a while: it's closed
  const sent = tg.sent.length;
  tg.say('coffee 35');
  assert.ok(await until(() => tg.sent.length > sent));
  assert.match(tg.sent.at(-1).text, /Saved: <b>coffee 35<\/b>/);
  await api({ a: 'snapshot', snapshot: { today: '📊 <b>Today</b>: spent 35 MDL', safe: '🟢 Safe to spend today: <b>300 MDL</b> left' } });
  tg.say('/today');
  assert.ok(await until(() => /Today<\/b>: spent 35 MDL[\s\S]*PC is off/.test(tg.sent.at(-1)?.text || '')));
  tg.tap('cat:x:food');
  await new Promise((r) => setTimeout(r, 600));
  const pulled = await api({ a: 'pull' });
  assert.deepEqual(pulled.updates.map((u) => u.message?.text ?? u.callback_query?.data), ['coffee 35', '/today', 'cat:x:food']);
  assert.ok(pulled.updates[0].relayReply);
  await api({ a: 'ack', ids: pulled.updates.map((u) => u.update_id) });
  assert.equal((await api({ a: 'pull' })).updates.length, 0);
});

test('bot server: app open → a waiting pull returns the moment a message arrives, and the server stays quiet', async () => {
  await api({ a: 'pull' }); // the app is open
  const sent = tg.sent.length;
  const t0 = Date.now();
  const waiting = api({ a: 'pull', wait: 20 });
  await new Promise((r) => setTimeout(r, 300));
  tg.say('tea 15');
  const r = await waiting;
  assert.ok(Date.now() - t0 < 6000, 'arrived fast');
  assert.deepEqual(r.updates.map((u) => u.message.text), ['tea 15']);
  assert.equal(tg.sent.length, sent); // the app answers, not the server
  await api({ a: 'ack', ids: r.updates.map((u) => u.update_id) });
});

test('desktop bot module: with a server it never reads Telegram itself and gets messages live', async () => {
  process.env.FH_TG_API = tg.url();
  const require = createRequire(import.meta.url);
  const { createTelegram } = require('../electron/telegram.cjs');
  let mem = { token: TOKEN, botName: 'test_money_bot', chatId: CHAT }; // linked already, as after pairing
  const storage = { read: () => mem, write: (o) => { mem = JSON.parse(JSON.stringify(o)); }, remove: () => { mem = null; } };
  const got = [];
  const appCalls = [];
  const appNet = { fetch: (u, o) => { appCalls.push(String(u).split('/').pop()); return fetch(u, o); } };
  const linked = createTelegram({ app: {}, net: appNet, storage, onUpdates: (u) => got.push(...u) });
  await assert.rejects(linked.serverConnect('http://example.com', KEY), /https/);
  await linked.serverConnect(url, KEY);
  linked.start();
  assert.equal(linked.status().server.on, true);
  tg.say('taxi 50');
  assert.ok(await until(() => got.some((u) => u.message?.text === 'taxi 50')));
  linked.ack(got.filter((u) => u.message?.text === 'taxi 50').map((u) => u.update_id));
  assert.ok(await until(async () => (await api({ a: 'status' })).waiting === 0));
  await linked.snapshot({ today: 'x' });
  assert.ok((await api({ a: 'status' })).snapshotAt > 0);
  linked.stop();
  // The server is the only reader of the bot: the app never asked Telegram for updates.
  assert.equal(appCalls.filter((c) => c === 'getUpdates').length, 0);
  assert.ok(appCalls.includes('api'));
});
