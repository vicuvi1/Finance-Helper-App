import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSplit, splitTransfers, isSplit } from '../js/split.js';
import { defaultState } from '../js/model.js';

let n = 0;
const uid = () => `u${n++}`;
const income = { id: 'pay', type: 'income', amount: 1000000, currency: 'MDL', rate: 1, base: 1000000, date: '2026-10-10', account: 'card', category: 'work', note: 'client' };

test('jars only: the 70% goes to the Safe, the rest stays', () => {
  const s = defaultState();
  s.settings.savingsAccount = 'safe';
  const rows = planSplit(s, income);
  assert.deepEqual(rows.map((r) => [r.id, r.amount, r.to]), [['savings', 700000, 'safe'], ['living', 100000, 'card'], ['growth', 100000, 'card'], ['care', 100000, 'card']]);
  const { transfers } = splitTransfers(s, income, rows, { now: 5, uid });
  assert.equal(transfers.length, 1);
  assert.deepEqual([transfers[0].from, transfers[0].to, transfers[0].amount, transfers[0].splitOf], ['card', 'safe', 700000, 'pay']);
  s.tx.push(income, ...transfers);
  assert.equal(isSplit(s, 'pay'), true);
});

test('taxes first, then the rest by jars, to chosen accounts', () => {
  const s = defaultState();
  s.settings.savingsAccount = 'safe';
  s.settings.split = { taxPct: 12, taxAccount: 'wallet' };
  const rows = planSplit(s, income, { accounts: { growth: 'safe' } });
  assert.deepEqual(rows.map((r) => [r.id, r.amount, r.to]), [['tax', 120000, 'wallet'], ['savings', 616000, 'safe'], ['living', 88000, 'card'], ['growth', 88000, 'safe'], ['care', 88000, 'card']]);
  assert.equal(rows.reduce((a, r) => a + r.amount, 0), 1000000);
  const { transfers } = splitTransfers(s, income, rows, { now: 5, uid });
  assert.deepEqual(transfers.map((t) => [t.to, t.amount]), [['wallet', 120000], ['safe', 616000], ['safe', 88000]]);
});

test('another currency: priced with the rates, or skipped without them', () => {
  const s = defaultState();
  s.settings.accounts.push({ id: 'usd', name: 'USD', currency: 'USD' });
  s.settings.savingsAccount = 'usd';
  const rows = planSplit(s, income);
  assert.deepEqual(splitTransfers(s, income, rows, { now: 5, uid }).skipped, ['savings']);
  s.rates = { usd: { MDL: 20 } };
  const t = splitTransfers(s, income, rows, { now: 5, uid }).transfers[0];
  assert.ok(t.toAmount > 0);
});
