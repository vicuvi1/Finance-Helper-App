import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, describe, snapshot, diff } from '../js/history.js';
import { defaultState, removeTx } from '../js/model.js';
import { mergeStates, toCloud } from '../js/sync.js';

const tx = (id, amount, extra = {}) => ({ id, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-10-10', category: 'food', account: 'wallet', note: 'x', updatedAt: 1, ...extra });

test('undo and redo an edit, a delete and an add', () => {
  const s = defaultState();
  s.tx.push(tx('a', 100), tx('b', 200));
  const h = createHistory();
  h.reset(s);

  s.tx[0].amount = 999;
  assert.equal(h.record(s).label, 'edited a record');
  removeTx(s, 'b', 50);
  assert.equal(h.record(s).label, 'deleted a record');
  s.tx.push(tx('c', 300));
  h.record(s);

  assert.equal(h.undo(s, 100).label, 'added a record');
  assert.deepEqual(s.tx.map((t) => t.id), ['a']);
  assert.equal(s.deleted.c, 100);
  h.undo(s, 101);
  assert.deepEqual(s.tx.map((t) => t.id), ['a', 'b'], 'restored in its old place');
  assert.equal(s.deleted.b, undefined);
  assert.equal(s.tx[1].updatedAt, 101, 'restored copy wins a sync');
  h.undo(s, 102);
  assert.equal(s.tx[0].amount, 100);
  assert.equal(h.canUndo(), false);

  h.redo(s, 103);
  assert.equal(s.tx[0].amount, 999);
  h.redo(s, 104);
  assert.deepEqual(s.tx.map((t) => t.id), ['a']);
  assert.equal(h.nextRedo(), 'added a record');
  // A new change drops the redo steps.
  s.tx[0].note = 'y';
  h.record(s);
  assert.equal(h.canRedo(), false);
});

test('bulk changes are one step', () => {
  const s = defaultState();
  for (let i = 0; i < 5; i++) s.tx.push(tx(`t${i}`, 100));
  const h = createHistory();
  h.reset(s);
  for (const t of s.tx) t.category = 'transport';
  assert.equal(h.record(s).label, 'edited 5 records');
  h.undo(s);
  assert.ok(s.tx.every((t) => t.category === 'food'));
});

test('settings and accounts undo; theme and meta are left alone', () => {
  const s = defaultState();
  const h = createHistory();
  h.reset(s);
  const name = s.settings.accounts[0].name;
  s.settings.accounts[0].name = 'Renamed';
  s.settings.testFlag = 5;
  s.settings.theme = 'light';
  s.meta.x = 1;
  assert.equal(h.record(s).label, 'edited an account and changed settings');
  h.undo(s);
  assert.equal(s.settings.accounts[0].name, name);
  assert.equal('testFlag' in s.settings, false);
  assert.equal(s.settings.theme, 'light');
  assert.equal(s.meta.x, 1);
});

test('device-only changes and unchanged saves make no step', () => {
  const s = defaultState();
  const h = createHistory();
  h.reset(s);
  s.meta.lastSync = 5;
  s.settings.logView = 'table';
  assert.equal(h.record(s), null);
  assert.equal(h.canUndo(), false);
});

test('reset skips changes that came from sync', () => {
  const s = defaultState();
  const h = createHistory();
  h.reset(s);
  s.tx.push(tx('synced', 100));
  h.reset(s);
  s.tx.push(tx('mine', 100));
  h.record(s);
  h.undo(s);
  assert.deepEqual(s.tx.map((t) => t.id), ['synced']);
});

test('an undone delete survives a sync with the old tombstone', () => {
  const s = defaultState();
  s.tx.push(tx('a', 100));
  const h = createHistory();
  h.reset(s);
  removeTx(s, 'a', 1000);
  h.record(s);
  const cloud = { app: 'finance-helper', schema: s.version, ...toCloud(s, 'd1') };
  h.undo(s, 2000);
  const merged = mergeStates(s, JSON.parse(JSON.stringify(cloud))).state;
  assert.deepEqual(merged.tx.map((t) => t.id), ['a']);
});

test('describe', () => {
  assert.equal(describe([{ list: 'tx', kind: 'removed' }, { list: 'tx', kind: 'removed' }, { list: 'invoices', kind: 'added' }]), 'deleted 2 records and added an invoice');
  const s = defaultState();
  assert.deepEqual(diff(snapshot(s), snapshot(s)), []);
});
