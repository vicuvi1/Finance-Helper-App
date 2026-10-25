// Which accounts are spending money for Safe to spend. Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spendingIds, spentFrom } from '../js/forecast.js';
import { safeToSpend } from '../js/safespend.js';
import { defaultState } from '../js/model.js';

const tx = (date, type, amount, extra = {}) => ({ id: `${date}-${type}-${amount}-${Math.random()}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'family' : 'food', account: 'card', note: '', ...extra });

// A card with 500, a wallet marked as savings with 3 000 that you spend from,
// a safe, and a business account with 100 000 of client money.
function state() {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'card').start = 50000;
  const w = s.settings.accounts.find((a) => a.id === 'wallet');
  w.start = 300000;
  w.savings = true;
  s.settings.accounts.push({ id: 'biz', name: 'Business', kind: 'business', currency: 'MDL', start: 10000000, color: 2 });
  for (const d of ['2026-10-05', '2026-10-09', '2026-10-12']) s.tx.push(tx(d, 'expense', 5000, { account: 'wallet' }));
  s.tx.push(tx('2026-10-10', 'expense', 2000, { account: 'card' }));
  return s;
}

test('business money is never spending money', () => {
  const ids = spendingIds(state(), '2026-10-16');
  assert.ok(!ids.has('biz'));
  assert.ok(ids.has('card'));
});

test('the wallet you actually spend from counts, even when it is marked as savings', () => {
  const s = state();
  assert.equal(spentFrom(s, '2026-10-16')[0].id, 'wallet');
  assert.ok(spendingIds(s, '2026-10-16').has('wallet'));
  assert.ok(!spendingIds(s, '2026-10-16').has('safe'));
  // Card 500 − 20 + wallet 3 000 − 150 = 3 330 (the business 100 000 isn't counted).
  assert.equal(safeToSpend(s, '2026-10-16').liquid, 333000);
});

test('your own pick wins; the salary buffer never counts', () => {
  const s = state();
  s.settings.spendFrom = ['card', 'biz'];
  assert.deepEqual([...spendingIds(s, '2026-10-16')].sort(), ['biz', 'card']);
  s.settings.pay = { on: true, buffer: 'biz', to: 'card', amount: 100000, day: 1, auto: false };
  assert.deepEqual([...spendingIds(s, '2026-10-16')], ['card']);
});
