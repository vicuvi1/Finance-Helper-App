import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, searchTx, searchSummary } from '../js/search.js';
import { defaultState } from '../js/model.js';

const s = defaultState();
const acc = s.settings.accounts[0];
acc.bank = 'maib';
let n = 0;
const tx = (date, type, amount, note, extra = {}) => ({ id: `s${n++}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'other-in' : 'food', account: acc.id, note, ...extra });
s.tx.push(
  tx('2026-03-02', 'expense', 3500, 'Coffee'),
  tx('2026-03-15', 'expense', 125000, 'Phone'),
  tx('2025-03-20', 'expense', 3500, 'cafea'),
  tx('2026-10-10', 'expense', 4550, 'Lunch'),
  tx('2026-10-09', 'income', 500000, 'Salary'),
  tx('2026-07-01', 'expense', 20000, 'Taxi 35 lei tip'),
);
const ids = (q) => searchTx(s, q, '2026-10-10').map((t) => t.note);

test('parse', () => {
  const q = parseQuery('coffee > 1 000 march 2026 spent');
  assert.equal(q.min, 100001);
  assert.deepEqual(q.words, ['coffee']);
  assert.deepEqual(q.months, [3]);
  assert.equal(q.year, '2026');
  assert.equal(q.type, 'expense');
  assert.deepEqual([parseQuery('50 - 200').min, parseQuery('50 - 200').max], [5000, 20000]);
});

test('words, amounts, dates, types', () => {
  assert.deepEqual(ids('coffee'), ['Coffee']);
  assert.deepEqual(ids('>1000'), ['Phone', 'Salary']);
  assert.deepEqual(ids('<=35'), ['Coffee', 'cafea']);
  assert.deepEqual(ids('35'), ['Coffee', 'cafea', 'Taxi 35 lei tip']);
  assert.deepEqual(ids('45'), ['Lunch'], 'whole lei match 45.50');
  assert.deepEqual(ids('march'), ['Coffee', 'Phone', 'cafea']);
  assert.deepEqual(ids('mar 2025'), ['cafea']);
  assert.deepEqual(ids('today'), ['Lunch']);
  assert.deepEqual(ids('yesterday'), ['Salary']);
  assert.deepEqual(ids('earned'), ['Salary']);
  assert.deepEqual(ids('100-300'), ['Taxi 35 lei tip']);
  assert.equal(ids('maib').length, 6, 'bank name');
  assert.deepEqual(ids('food phone'), ['Phone'], 'category + note');
  assert.deepEqual(ids('nothing here'), []);
});

test('summary', () => {
  const r = searchSummary(searchTx(s, 'march', '2026-10-10'));
  assert.deepEqual(r, { count: 3, spent: 132000, earned: 0, first: '2025-03-20', last: '2026-03-15', months: 2 });
});
