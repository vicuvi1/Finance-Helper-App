import test from 'node:test';
import assert from 'node:assert/strict';
import { afterPayments, monthsToPayOff, debtStatus, addDebt, setBalance, removeDebt, payMore } from '../js/debts.js';
import { defaultState } from '../js/model.js';

test('payoff math', () => {
  assert.equal(monthsToPayOff(1200000, 0, 100000), 12);
  // 50 000 at 18%/year, 2 000 a month: about 32 months
  const r = 0.18 / 12;
  const n = monthsToPayOff(5000000, r, 200000);
  assert.ok(n >= 31 && n <= 33, String(n));
  assert.equal(monthsToPayOff(5000000, r, 50000), Infinity, 'the payment does not cover the interest');
  assert.equal(afterPayments(1200000, 0, 100000, 3), 900000);
  assert.ok(afterPayments(5000000, r, 200000, 1) === 5000000 + 75000 - 200000);
});

test('a loan with its monthly bill; payments logged bring it down; removing pauses the bill', () => {
  const s = defaultState();
  const d = addDebt(s, { name: 'Made-up car loan', balance: 5000000, rate: 18, payment: 200000, day: 10 }, { id: 'd1', ruleId: 'r1', now: 1, today: '2026-11-22' });
  assert.equal(s.settings.debts.length, 1);
  const rule = s.recurring.find((x) => x.id === 'r1');
  assert.equal(rule.amount, 200000);
  assert.equal(rule.start, '2026-12-10');
  assert.equal(rule.debtId, 'd1');
  let st = debtStatus(s, d, '2026-11-22');
  assert.equal(st.left, 5000000);
  assert.ok(st.payoff > '2029-01' && st.payoff < '2029-09', st.payoff);
  assert.ok(st.interestLeft > 1000000);
  s.tx.push({ id: 'p1', date: '2026-12-10', type: 'expense', amount: 200000, currency: 'MDL', account: rule.account, category: rule.category, recurring: 'r1', note: 'x', createdAt: 2, updatedAt: 2 });
  st = debtStatus(s, d, '2026-12-11');
  assert.equal(st.paid, 1);
  assert.equal(st.left, 4875000);
  const more = payMore(d, st.left, 100000);
  assert.ok(more.months > 5 && more.saved > 0);
  setBalance(s, 'd1', 4800000, { now: 3, today: '2026-12-12' });
  assert.equal(debtStatus(s, s.settings.debts[0], '2026-12-12').left, 4800000);
  removeDebt(s, 'd1', { now: 4 });
  assert.equal(s.settings.debts.length, 0);
  assert.equal(s.recurring.find((x) => x.id === 'r1').paused, true);
});
