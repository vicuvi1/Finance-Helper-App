import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyReview, loggingStreak, cashCheck } from '../js/review.js';
import { defaultState, accountBalances } from '../js/model.js';

let n = 0;
const tx = (date, type, amount, category, extra = {}) => ({ id: `r${n++}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category, account: 'wallet', note: 'x', ...extra });

test('streak counts days in a row, today not required yet', () => {
  const s = defaultState();
  s.tx.push(tx('2026-10-07', 'expense', 100, 'food'), tx('2026-10-08', 'expense', 100, 'food'), tx('2026-10-09', 'expense', 100, 'food'), tx('2026-10-05', 'expense', 100, 'food'));
  assert.equal(loggingStreak(s, '2026-10-10'), 3);
  s.tx.push(tx('2026-10-10', 'expense', 100, 'food'));
  assert.equal(loggingStreak(s, '2026-10-10'), 4);
});

test('weekly review: kept %, usual week, biggest leak, Other records', () => {
  const s = defaultState();
  // 4 usual weeks: 1 000 food each.
  for (let w = 1; w <= 4; w++) s.tx.push(tx(`2026-09-${String(30 - 7 * w).padStart(2, '0')}`, 'expense', 100000, 'food'));
  // This week (Oct 4-10): income 10 000, food 1 000, fun 2 500, and an "Other".
  s.tx.push(tx('2026-10-05', 'income', 1000000, 'work'), tx('2026-10-06', 'expense', 100000, 'food'), tx('2026-10-07', 'expense', 250000, 'fun'), tx('2026-10-08', 'expense', 5000, 'other', { note: 'kiosk' }));
  const r = weeklyReview(s, '2026-10-10');
  assert.equal(r.from, '2026-10-04');
  assert.equal(r.expense, 355000);
  assert.equal(Math.round(r.kept * 100), 65);
  assert.equal(r.target, 70);
  assert.equal(r.usual, 100000);
  assert.equal(r.leak.category, 'fun');
  assert.equal(r.leak.over, 250000);
  assert.deepEqual(r.other.map((t) => t.note), ['kiosk']);
});

test('cash check settles the difference with one record', () => {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'wallet').start = 200000; // app thinks 2 000
  s.tx.push(tx('2026-10-01', 'expense', 30000, 'food'));
  const r = cashCheck(s, 'wallet', 124000, { date: '2026-10-10', id: 'cc1', now: 1 });
  assert.equal(r.expected, 170000);
  assert.equal(r.diff, -46000);
  assert.equal(r.tx.type, 'expense');
  assert.equal(r.tx.amount, 46000);
  s.tx.push(r.tx);
  assert.equal(accountBalances(s).wallet, 124000);
  assert.equal(cashCheck(s, 'wallet', 124000, { date: '2026-10-10', id: 'cc2' }).tx, null);
  assert.equal(cashCheck(s, 'wallet', 130000, { date: '2026-10-10', id: 'cc3' }).tx.type, 'income');
});
