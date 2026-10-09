import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, budgetStatus, budgetAlert, averageSpend, insights, category } from '../js/model.js';

let n = 0;
const ex = (date, amount, cat, extra = {}) => ({ id: `t${n++}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date, category: cat, account: 'card', note: '', ...extra });

function state() {
  const s = defaultState();
  category(s, 'food').budget = 300000; // 3 000 MDL
  category(s, 'fun').budget = 100000;
  s.tx.push(ex('2026-10-02', 120000, 'food'), ex('2026-10-05', 60000, 'food'), ex('2026-10-03', 90000, 'fun'), ex('2026-10-04', 50000, 'fun', { loan: true }));
  return s;
}

test('status per category, with pace', () => {
  const st = budgetStatus(state(), '2026-10', '2026-10-10');
  const food = st.rows.find((r) => r.category.id === 'food');
  const fun = st.rows.find((r) => r.category.id === 'fun');
  assert.equal(food.spent, 180000);
  assert.equal(food.projected, 558000); // 1 800 in 10 days -> 5 580 in 31
  assert.equal(food.level, 'pace');
  assert.equal(fun.spent, 90000); // the loan doesn't count
  assert.equal(fun.level, 'near');
  assert.equal(st.budget, 400000);
  assert.equal(st.daysLeft, 21);
  assert.equal(st.rows[0].category.id, 'fun'); // most used first
  // A past month: no projection.
  assert.equal(budgetStatus(state(), '2026-10', '2026-12-01').rows.find((r) => r.category.id === 'food').level, 'ok');
});

test('alerts when a new expense crosses 80% or 100%', () => {
  const s = state();
  const t1 = ex('2026-10-12', 70000, 'food');
  s.tx.push(t1);
  assert.equal(budgetAlert(s, t1)?.level, 'near'); // 1 800 -> 2 500 of 3 000
  const t2 = ex('2026-10-13', 10000, 'food');
  s.tx.push(t2);
  assert.equal(budgetAlert(s, t2), null); // already past 80%
  const t3 = ex('2026-10-14', 60000, 'food');
  s.tx.push(t3);
  assert.match(budgetAlert(s, t3).text, /over budget/);
  assert.equal(budgetAlert(s, ex('2026-10-14', 100, 'health')), null); // no budget
});

test('average of the last full months, and tips', () => {
  const s = state();
  s.tx.push(ex('2026-09-10', 300000, 'food'), ex('2026-08-10', 150000, 'food'));
  assert.equal(averageSpend(s, 'food', '2026-10'), 150000);
  const tips = insights(s, '2026-10', '2026-10-10');
  assert.ok(tips.some((t) => /Fun.*80%|Fun.*90%/.test(t.title)));
  assert.ok(tips.some((t) => /Food: on pace/.test(t.title)));
});
