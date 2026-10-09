import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, removeTx } from '../js/model.js';
import { mergeStates, toCloud } from '../js/sync.js';

const tx = (id, amount, updatedAt) => ({ id, type: 'expense', amount, base: amount, currency: 'MDL', date: '2026-10-01', account: 'wallet', category: 'food', updatedAt, createdAt: updatedAt });

function devices() {
  const pc = defaultState();
  const phone = defaultState();
  return { pc, phone };
}

test('first sync with an empty Drive just uploads', () => {
  const { pc } = devices();
  pc.tx.push(tx('a', 100, 1));
  const r = mergeStates(pc, null);
  assert.equal(r.pushNeeded, true);
  assert.equal(r.state.tx.length, 1);
});

test('records added on two devices end up on both', () => {
  const { pc, phone } = devices();
  pc.tx.push(tx('a', 100, 1));
  phone.tx.push(tx('b', 200, 2));
  const onPc = mergeStates(pc, toCloud(phone, 'phone'));
  assert.deepEqual(onPc.state.tx.map((t) => t.id).sort(), ['a', 'b']);
  assert.equal(onPc.pullChanged, true);
  assert.equal(onPc.pushNeeded, true);
  // Syncing the merged result again changes nothing.
  const again = mergeStates(onPc.state, toCloud(onPc.state, 'pc'));
  assert.equal(again.pullChanged, false);
  assert.equal(again.pushNeeded, false);
});

test('the newest edit of a record wins', () => {
  const { pc, phone } = devices();
  pc.tx.push(tx('a', 100, 1));
  phone.tx.push({ ...tx('a', 999, 5) });
  assert.equal(mergeStates(pc, toCloud(phone, 'phone')).state.tx[0].amount, 999);
  assert.equal(mergeStates(phone, toCloud(pc, 'pc')).state.tx[0].amount, 999);
});

test('a deletion on one device is not undone by the other', () => {
  const { pc, phone } = devices();
  pc.tx.push(tx('a', 100, 1));
  phone.tx.push(tx('a', 100, 1));
  removeTx(phone, 'a', 10);
  const r = mergeStates(pc, toCloud(phone, 'phone'));
  assert.equal(r.state.tx.length, 0);
  assert.equal(r.state.deleted.a, 10);
  // ...but an edit made after the deletion brings it back.
  pc.tx[0].updatedAt = 20;
  assert.equal(mergeStates(pc, toCloud(phone, 'phone')).state.tx.length, 1);
});

test('settings follow the newest change; theme and PIN stay on the device', () => {
  const { pc, phone } = devices();
  pc.settings.theme = 'light';
  pc.meta.lock = { hash: 'x' };
  phone.settings.goal = { name: 'Car', target: 5000000, account: 'all' };
  phone.settings.updatedAt = 50;
  const cloud = toCloud(pc, 'pc');
  assert.equal(cloud.data.settings.theme, undefined);
  assert.equal(JSON.stringify(cloud).includes('"lock"'), false);
  const r = mergeStates(pc, toCloud(phone, 'phone'));
  assert.equal(r.state.settings.goal.name, 'Car');
  assert.equal(r.state.settings.theme, 'light');
  assert.equal(r.state.meta.lock.hash, 'x');
});

test('accounts and people merge per record', () => {
  const { pc, phone } = devices();
  pc.settings.accounts.push({ id: 'maib', name: 'maib Visa', currency: 'MDL', updatedAt: 3 });
  phone.people.push({ id: 'p1', name: 'Ana', updatedAt: 4 });
  const r = mergeStates(pc, toCloud(phone, 'phone'));
  assert.ok(r.state.settings.accounts.some((a) => a.id === 'maib'));
  assert.ok(r.state.people.some((p) => p.id === 'p1'));
});

test('refuses data from a newer app version or another app', () => {
  const { pc } = devices();
  assert.throws(() => mergeStates(pc, { app: 'finance-helper', schema: 99, data: {} }), /newer version/);
  assert.throws(() => mergeStates(pc, { app: 'other', data: {} }), /not Finance Helper/);
});
