import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTelegram } = require('../electron/telegram.cjs');

const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// A tiny fake of the Bot API: queued updates, recorded sends.
function fakeTelegram() {
  const queue = [];
  const sent = [];
  let confirmed = 0;
  const net = {
    async fetch(url, opts) {
      const method = url.split('/').pop();
      const body = JSON.parse(opts.body || '{}');
      let result = true;
      if (method === 'getMe') result = { username: 'my_money_bot' };
      else if (method === 'getUpdates') {
        confirmed = Math.max(confirmed, body.offset || 0);
        await new Promise((r) => setTimeout(r, 5));
        result = queue.filter((u) => u.update_id >= confirmed);
      } else if (method === 'sendMessage') sent.push(body);
      return { status: 200, json: async () => ({ ok: true, result }) };
    },
  };
  return { net, queue, sent, confirmed: () => confirmed };
}

const memory = () => { let v = null; return { read: () => v, write: (o) => { v = JSON.parse(JSON.stringify(o)); }, remove: () => { v = null; } }; };
const msg = (id, chat, text) => ({ update_id: id, message: { message_id: id, chat: { id: chat, type: 'private' }, from: { first_name: 'Owner' }, text, date: 1760000000 } });
const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); };

test('links with the code, listens only to that chat, confirms after the app handles', async () => {
  const tg = fakeTelegram();
  const got = [];
  const events = [];
  const bot = createTelegram({ app: {}, net: tg.net, storage: memory(), onUpdates: (u) => got.push(...u), onEvent: (e) => events.push(e) });
  await assert.rejects(bot.connect('nope'), /bot token/);
  assert.equal((await bot.connect(TOKEN)).botName, 'my_money_bot');
  const { code, link } = bot.pair();
  assert.equal(link, `https://t.me/my_money_bot?start=${code}`);
  tg.queue.push(msg(1, 111, '/start 000000'), msg(2, 222, `/start ${code}`));
  await until(() => bot.status().linked);
  assert.equal(bot.status().linked, true);
  assert.ok(events.some((e) => e.type === 'linked'));
  assert.equal(tg.sent[0].chat_id, 111); // wrong code got a hint, nothing else
  tg.queue.push(msg(3, 999, 'coffee 35'), msg(4, 222, 'coffee 35'));
  await until(() => got.length);
  assert.deepEqual(got.map((u) => u.update_id), [4]); // the stranger is ignored
  // Not confirmed until the app says so.
  assert.ok(tg.confirmed() <= 4);
  bot.ack([4]);
  await until(() => tg.confirmed() >= 5);
  assert.equal(tg.confirmed(), 5);
  await bot.send('hi');
  assert.equal(tg.sent.at(-1).chat_id, 222);
  await bot.disconnect();
  assert.equal(bot.status().connected, false);
});

test('nothing is kept when the token cannot be stored safely', async () => {
  const tg = fakeTelegram();
  const failing = { read: () => null, write: () => { throw new Error('This computer has no secure key storage available.'); }, remove() {} };
  const bot = createTelegram({ app: {}, net: tg.net, storage: failing });
  await assert.rejects(bot.connect(TOKEN), /secure key storage/);
  assert.equal(bot.status().connected, false);
});

test('load now checks right away and says what came; the command menu is set', async () => {
  const tg = fakeTelegram();
  const got = [];
  const calls = [];
  const net = { fetch: (url, opts) => { calls.push(url.split('/').pop()); return tg.net.fetch(url, opts); } };
  const bot = createTelegram({ app: {}, net, storage: memory(), onUpdates: (u) => got.push(...u) });
  await bot.connect(TOKEN);
  const { code } = bot.pair();
  tg.queue.push(msg(1, 222, `/start ${code}`));
  await until(() => bot.status().linked);
  tg.queue.push(msg(2, 222, '☕ Coffee 20'));
  const n = await bot.loadNow();
  assert.ok(n >= 1);
  assert.deepEqual(got.map((u) => u.update_id), [2]);
  bot.ack([2]);
  await until(() => calls.includes('setMyCommands'));
  assert.ok(calls.includes('setMyCommands'));
  assert.equal(await bot.loadNow(), 0); // nothing new
  assert.ok(bot.status().lastCheck > 0);
  await bot.disconnect();
});

test('a new token for the same bot keeps the linked chat; a revoked token says so', async () => {
  const tg = fakeTelegram();
  let revoked = false;
  const net = { fetch: async (url, opts) => (revoked && url.includes(TOKEN) && !url.endsWith('getMe') ? { status: 401, json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' }) } : tg.net.fetch(url, opts)) };
  const events = [];
  const bot = createTelegram({ app: {}, net, storage: memory(), onUpdates: () => {}, onEvent: (e) => events.push(e) });
  await bot.connect(TOKEN);
  const { code } = bot.pair();
  tg.queue.push(msg(1, 222, `/start ${code}`));
  await until(() => bot.status().linked);
  revoked = true;
  await until(() => bot.status().errorCode === 'token');
  assert.match(bot.status().error, /doesn't accept the bot token/);
  const fresh = '123456789:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'; // same bot, new token
  const r = await bot.connect(fresh);
  assert.equal(r.kept, true);
  assert.equal(bot.status().linked, true);
  assert.equal(bot.status().error, '');
  const other = await bot.connect('987654321:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'); // another bot: link again
  assert.equal(other.kept, false);
  assert.equal(bot.status().linked, false);
  await bot.disconnect();
});

test('always on: the Google script keeps messages while the app is closed; the app collects and confirms them once', async () => {
  const { loadRelay } = await import('../e2e/appscript.mjs');
  // One bot, read by both the app (async fetch) and the Google script (sync).
  const queue = [];
  const sent = [];
  let confirmed = 0;
  const api = (method, body) => {
    if (method === 'getMe') return { username: 'my_money_bot' };
    if (method === 'getUpdates') { confirmed = Math.max(confirmed, body.offset || 0); return queue.filter((u) => u.update_id >= confirmed).slice(0, body.limit || 100); }
    if (method === 'sendMessage') { sent.push(body); return { message_id: 500 + sent.length }; }
    return true;
  };
  const URL_ = 'https://script.google.com/macros/s/TEST-deploy_1/exec';
  let relay = null;
  let clock = 1_000_000;
  const relayCalls = [];
  const net = {
    async fetch(url, opts = {}) {
      if (url.startsWith(URL_)) {
        const q = Object.fromEntries(new URL(url).searchParams);
        relayCalls.push(opts.method === 'POST' ? JSON.parse(opts.body).a : q.a);
        const out = opts.method === 'POST' ? relay.post(JSON.parse(opts.body)) : relay.get(q);
        return { status: 200, text: async () => JSON.stringify(out) };
      }
      await new Promise((r) => setTimeout(r, 5));
      return { status: 200, json: async () => ({ ok: true, result: api(url.split('/').pop(), JSON.parse(opts.body || '{}')) }) };
    },
  };
  const got = [];
  const bot = createTelegram({ app: {}, net, storage: memory(), onUpdates: (u) => got.push(...u) });
  await bot.connect(TOKEN);
  const { code } = bot.pair();
  queue.push(msg(1, 222, `/start ${code}`));
  await until(() => bot.status().linked);

  await assert.rejects(bot.relayConnect('https://example.com/x'), /Web app URL/);
  const script = await bot.relayScript();
  const key = script.match(/const KEY = '([\w-]+)'/)[1];
  assert.ok(key.length >= 30);
  relay = loadRelay({ key, telegram: { call: (m, p) => api(m, p) }, now: () => clock });
  const on = await bot.relayConnect(URL_);
  assert.equal(on.trigger, true);
  assert.equal(bot.status().relay.on, true);

  // PC off: the app stops; Google answers and keeps the message.
  bot.stop();
  clock += 120_000;
  queue.push(msg(2, 222, 'coffee 35'));
  relay.poll();
  assert.match(sent.at(-1).text, /Saved: <b>coffee 35<\/b>/);
  assert.equal(confirmed, 3);
  assert.equal(relay.get({ k: key, a: 'status' }).waiting, 1);

  // PC on: the app collects it from Google, handles it once, confirms it there.
  bot.start();
  assert.ok((await bot.loadNow()) >= 1);
  await until(() => got.some((u) => u.update_id === 2));
  assert.deepEqual(got.filter((u) => u.update_id === 2).length, 1);
  bot.ack([2]);
  await until(() => relayCalls.includes('ack'));
  await until(() => relay.get({ k: key, a: 'status' }).waiting === 0);
  assert.equal(relay.get({ k: key, a: 'status' }).waiting, 0);
  assert.ok(bot.status().relay.okAt > 0);

  // While the app is open Google stays quiet.
  queue.push(msg(3, 222, 'tea 15'));
  relay.poll();
  assert.equal(sent.filter((m) => /Saved/.test(m.text)).length, 1);
  await bot.relayOff();
  assert.equal(bot.status().relay.on, false);
  assert.equal(relay.triggers.length, 0);
  await bot.disconnect();
});
