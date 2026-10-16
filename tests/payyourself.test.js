// Work vs personal money, and "Pay yourself" (a buffer and a fixed monthly
// salary). Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, personalMonth, isWorkIncome, isWorkCost, jarStatus, NO_JAR } from '../js/model.js';
import { suggestSalary, payStatus, salaryTx, salaryDate, runwayText } from '../js/payyourself.js';
import { safeToSpend } from '../js/safespend.js';

const tx = (date, type, amount, extra = {}) => ({ id: `${date}-${type}-${amount}-${Math.random()}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'work' : 'food', account: 'card', note: '', ...extra });

function state() {
  const s = defaultState();
  s.settings.categories.push({ id: 'wf', name: 'Work fees', type: 'expense', jar: NO_JAR });
  s.settings.accounts.push({ id: 'buf', name: 'Buffer', kind: 'card', currency: 'MDL', start: 0, color: 3 });
  // Three usual months: 25 000 from clients, 5 000 of work fees, 1 000 from family.
  for (const m of ['07', '08', '09']) {
    s.tx.push(tx(`2026-${m}-05`, 'income', 2500000, { account: 'buf' }));
    s.tx.push(tx(`2026-${m}-06`, 'expense', 500000, { category: 'wf', account: 'buf' }));
    s.tx.push(tx(`2026-${m}-07`, 'income', 100000, { category: 'family' }));
  }
  // October: the client hasn't paid yet; work fees 6 000, rent 4 000, food 1 000.
  s.tx.push(tx('2026-10-10', 'expense', 600000, { category: 'wf', account: 'buf' }));
  s.tx.push(tx('2026-10-16', 'expense', 400000, { category: 'home' }));
  s.tx.push(tx('2026-10-12', 'expense', 100000));
  s.tx.push(tx('2026-10-04', 'income', 200000, { category: 'family' }));
  return s;
}

test('work vs personal: client income and work fees are the work; the rest is your life', () => {
  const s = state();
  assert.equal(isWorkIncome(s, 'work'), true);
  assert.equal(isWorkIncome(s, 'side'), true);
  assert.equal(isWorkIncome(s, 'family'), false);
  assert.equal(isWorkCost(s, 'wf'), true);
  assert.equal(isWorkCost(s, 'food'), false);
  const oct = personalMonth(s, '2026-10');
  assert.equal(oct.workIncome, 0);
  assert.equal(oct.workCosts, 600000);
  assert.equal(oct.personalSpent, 500000); // rent + food: what you lived on
  const sep = personalMonth(s, '2026-09');
  assert.equal(sep.profit, 2000000);
  assert.equal(sep.personalIncome, 2100000); // profit + family
});

test('a safe salary: 80% of the usual work profit, in whole hundreds', () => {
  const s = state();
  const sug = suggestSalary(s, '2026-10-16');
  assert.equal(sug.average, 2000000);
  assert.equal(sug.amount, 1600000);
  assert.equal(sug.months, 3);
});

test('pay yourself: salary due on its day, one transfer from the buffer, runway in months', () => {
  const s = state();
  s.settings.pay = { on: true, buffer: 'buf', to: 'card', amount: 1600000, day: 15, auto: false };
  let st = payStatus(s, '2026-10-16');
  assert.equal(st.date, '2026-10-15');
  assert.equal(st.due, true);
  // Buffer: 3 × 25 000 − 3 × 5 000 − 6 000 = 54 000 → 3.4 months of salary.
  assert.equal(st.bufferBalance, 5400000);
  assert.equal(Math.round(st.runway * 10) / 10, 3.4);
  const t = salaryTx(s, '2026-10-16', { id: 'sal', now: 1 });
  assert.equal(t.amount, 1600000);
  assert.equal(t.from, 'buf');
  assert.equal(t.to, 'card');
  assert.equal(t.salary, '2026-10');
  s.tx.push(t);
  st = payStatus(s, '2026-10-16');
  assert.equal(st.due, false);
  assert.equal(st.next, '2026-11-15');
  // The salary is what came in for you this month (plus family money).
  assert.equal(personalMonth(s, '2026-10').personalIncome, 1800000);
  // Jars are measured on the salary, not on lumpy client income.
  assert.equal(jarStatus(s, '2026-10', '2026-10-16').find((j) => j.jar.id === 'living').basis, 1800000);
  assert.equal(salaryDate('2026-02', 31), '2026-02-28');
  assert.equal(runwayText(3.4), '3.4 months');
  assert.equal(runwayText(0.5), '2 weeks');
});

test('safe to spend with a salary: the buffer is not spending money, payday is salary day', () => {
  const s = state();
  s.settings.pay = { on: true, buffer: 'buf', to: 'card', amount: 1600000, day: 15, auto: false };
  s.tx.push(salaryTx(s, '2026-10-15', { id: 'sal' }));
  const r = safeToSpend(s, '2026-10-16');
  assert.equal(r.payday, '2026-11-15');
  assert.equal(r.paydayFrom, 'salary');
  // Card: 16 000 salary + 5 000 family − 4 000 rent − 1 000 food = 16 000 (the buffer's 38 000 isn't counted).
  assert.equal(r.liquid, 1600000);
  assert.equal(r.savingsLeft, 0); // saving happens in the buffer
});

test('a salary between currencies converts at the current rate', () => {
  const s = state();
  s.settings.accounts.push({ id: 'usd', name: 'Clients USD', kind: 'card', currency: 'USD', start: 500000, color: 4 });
  s.rates = { usd: { MDL: 17.5 } };
  s.settings.pay = { on: true, buffer: 'usd', to: 'card', amount: 1750000, day: 1, auto: false };
  const t = salaryTx(s, '2026-10-16', { id: 'x' });
  assert.equal(t.currency, 'USD');
  assert.equal(t.amount, 100000); // 1 000 USD
  assert.equal(t.toAmount, 1750000); // 17 500 MDL
  assert.equal(t.base, 1750000);
});
