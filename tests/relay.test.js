// The always-on bot script (electron/relay.gs), run with fake Apps Script
// services: it answers while the app is closed, keeps messages for the app,
// stays quiet while the app is open, and only obeys the app's key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRelay } from '../e2e/appscript.mjs';

const CHAT = 4242;
function fakeBot() {
  const queue = [];
  const sent = [];
  let confirmed = 0;
  let id = 1;
  return {
    queue, sent,
    confirmed: () => confirmed,
    say(text, chat = CHAT) { queue.push({ update_id: id, message: { message_id: id, date: 1, text, chat: { id: chat, type: 'private' }, from: { first_name: 'Owner' } } }); return id++; },
    tap(data) { queue.push({ update_id: id, callback_query: { id: `q${id}`, data, message: { message_id: 1, chat: { id: CHAT } } } }); return id++; },
    call(method, p) {
      if (method === 'getMe') return { username: 'my_bot' };
      if (method === 'getUpdates') { confirmed = Math.max(confirmed, p.offset || 0); return queue.filter((u) => u.update_id >= confirmed).slice(0, p.limit || 100); }
      if (method === 'sendMessage' || method === 'answerCallbackQuery') { sent.push({ method, ...p }); return { message_id: 900 + sent.length }; }
      return true;
    },
  };
}

test('relay: obeys only its key, sets up a one-minute check', () => {
  const bot = fakeBot();
  const r = loadRelay({ telegram: bot });
  assert.equal(r.get({ k: 'nope', a: 'status' }).ok, false);
  const s = r.post({ k: 'test-key', a: 'setup', token: '1:AA', chat: CHAT });
  assert.equal(s.ok, true);
  assert.equal(s.trigger, true);
  assert.equal(r.triggers[0].n, 1);
  assert.equal(r.store.get('token'), '1:AA');
});

test('relay: app closed → answers, keeps the messages, confirms them; app collects and acks', () => {
  let clock = 1_000_000;
  const bot = fakeBot();
  const r = loadRelay({ telegram: bot, now: () => clock });
  r.post({ k: 'test-key', a: 'setup', token: '1:AA', chat: CHAT });
  clock += 120_000; // the app hasn't collected for 2 minutes: it's closed
  bot.say('coffee 35');
  bot.say('/today');
  bot.say('hello', 999); // a stranger
  bot.tap('cat:tx1:food');
  r.poll();
  assert.match(bot.sent[0].text, /Saved: <b>coffee 35<\/b>/);
  assert.equal(bot.sent[0].reply_to_message_id, 1);
  assert.match(bot.sent[1].text, /PC is off/);
  assert.equal(bot.sent[2].method, 'answerCallbackQuery');
  assert.equal(bot.sent.length, 3); // nothing to the stranger
  assert.equal(bot.confirmed(), 5); // all confirmed to Telegram
  const pulled = r.get({ k: 'test-key', a: 'pull' });
  assert.deepEqual(pulled.updates.map((u) => u.update_id), [1, 2, 4]);
  assert.equal(pulled.updates[0].relayReply, 901);
  assert.equal(pulled.waiting, 3);
  r.get({ k: 'test-key', a: 'ack', ids: '1,2' });
  assert.deepEqual(r.get({ k: 'test-key', a: 'pull' }).updates.map((u) => u.update_id), [4]);
});

test('relay: app open (collected recently) → stays quiet and leaves Telegram to the app', () => {
  let clock = 1_000_000;
  const bot = fakeBot();
  const r = loadRelay({ telegram: bot, now: () => clock });
  r.post({ k: 'test-key', a: 'setup', token: '1:AA', chat: CHAT });
  r.get({ k: 'test-key', a: 'pull' });
  clock += 30_000;
  bot.say('coffee 35');
  r.poll();
  assert.equal(bot.sent.length, 0);
  assert.equal(bot.confirmed(), 0);
  assert.equal(r.get({ k: 'test-key', a: 'pull' }).updates.length, 0);
});

test('relay: turning it off removes the check and everything stored', () => {
  const bot = fakeBot();
  const r = loadRelay({ telegram: bot });
  r.post({ k: 'test-key', a: 'setup', token: '1:AA', chat: CHAT });
  assert.equal(r.get({ k: 'test-key', a: 'off' }).ok, true);
  assert.equal(r.triggers.length, 0);
  assert.equal(r.store.size, 0);
});
