import test from 'node:test';
import assert from 'node:assert/strict';
import { yearData } from '../js/yearview.js';
import { defaultState } from '../js/model.js';

test('the year: months, totals, top categories, best month, last year', () => {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  const exp = s.settings.categories.filter((c) => c.type === 'expense');
  const inc = s.settings.categories.find((c) => c.type === 'income').id;
  let n = 0;
  const add = (date, type, amount, category) => s.tx.push({ id: `t${n++}`, date, type, amount, currency: 'MDL', account: acc, category, note: 'made-up', createdAt: 1, updatedAt: 1 });
  add('2025-06-01', 'income', 1000000, inc); add('2025-06-02', 'expense', 400000, exp[0].id);
  for (const m of ['01', '02', '03']) { add(`2026-${m}-01`, 'income', 2000000, inc); add(`2026-${m}-05`, 'expense', 500000, exp[0].id); }
  add('2026-02-10', 'expense', 900000, exp[1].id);
  const y = yearData(s, 2026, '2026-04-15');
  assert.equal(y.months.length, 12);
  assert.equal(y.count, 3);
  assert.equal(y.total.income, 6000000);
  assert.equal(y.total.expense, 2400000);
  assert.equal(y.top[0].id, exp[0].id);
  assert.equal(y.best.key === '2026-01' || y.best.key === '2026-03', true);
  assert.equal(y.worst.key, '2026-02');
  assert.ok(y.months.find((m) => m.key === '2026-12').future);
  assert.equal(y.prev.income, 1000000);
  assert.ok(y.prev.incomeChange > 4);
});
