import test from 'node:test';
import assert from 'node:assert/strict';
import { runBudgetAuto, startBudgetAuto, undoBudgetAuto, markManual } from '../js/budgetauto.js';
import { defaultState } from '../js/model.js';

function withSpending() {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  const food = s.settings.categories.find((c) => c.type === 'expense' && /food/i.test(c.name)) || s.settings.categories.find((c) => c.type === 'expense');
  let n = 0;
  for (const m of ['2026-08', '2026-09', '2026-10']) {
    for (const d of ['05', '12', '19', '26']) s.tx.push({ id: `t${n++}`, date: `${m}-${d}`, type: 'expense', amount: 50000, currency: 'MDL', account: acc, category: food.id, note: 'made-up groceries', createdAt: 1, updatedAt: 1 });
  }
  return { s, food };
}

test('budgets set themselves once a month, can be undone, and respect a hand-set one', () => {
  const { s, food } = withSpending();
  assert.equal(runBudgetAuto(s, '2026-11-02', 1), null, 'off by default');
  const ch = startBudgetAuto(s, '2026-11-02', 2);
  assert.equal(ch.find((c) => c.id === food.id).to, 200000);
  assert.equal(s.settings.categories.find((c) => c.id === food.id).budget, 200000);
  assert.equal(runBudgetAuto(s, '2026-11-20', 3), null, 'once a month');
  assert.equal(undoBudgetAuto(s, 4), ch.length);
  assert.ok(!(s.settings.categories.find((c) => c.id === food.id).budget > 0));
  // December: a hand-set budget stays.
  s.settings.categories.find((c) => c.id === food.id).budget = 123400;
  markManual(s, food.id, '2026-12-01', 5);
  const dec = runBudgetAuto(s, '2026-12-01', 6);
  assert.equal(dec.some((c) => c.id === food.id), false);
  assert.equal(s.settings.categories.find((c) => c.id === food.id).budget, 123400);
});
