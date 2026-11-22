import test from 'node:test';
import assert from 'node:assert/strict';
import { monthsTo, freedom } from '../js/freedom.js';
import { defaultState } from '../js/model.js';

test('growth math', () => {
  assert.equal(monthsTo(0, 1200, 100, 0), 12);
  assert.equal(monthsTo(2000, 1000, 0, 0), 0);
  assert.equal(monthsTo(0, 1000, 0, 0), null);
  assert.ok(monthsTo(0, 120000, 1000, 5) < 120, 'a return gets there sooner');
});

test('freedom: months on your money, when 6 and 12 months come, years to free', () => {
  const s = defaultState();
  const acc = s.settings.accounts.find((a) => a.kind !== 'crypto');
  const inc = s.settings.categories.find((c) => c.type === 'income').id;
  const exp = s.settings.categories.find((c) => c.type === 'expense').id;
  let n = 0;
  for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
    s.tx.push({ id: `i${n}`, date: `${m}-01`, type: 'income', amount: 2000000, currency: 'MDL', account: acc.id, category: inc, note: 'made-up', createdAt: 1, updatedAt: 1 });
    s.tx.push({ id: `e${n++}`, date: `${m}-10`, type: 'expense', amount: 1000000, currency: 'MDL', account: acc.id, category: exp, note: 'made-up', createdAt: 1, updatedAt: 1 });
  }
  const f = freedom(s, '2026-11-15');
  assert.equal(f.monthly, 1000000);
  assert.equal(f.kept, 1000000);
  assert.ok(Math.abs(f.months - 6) < 0.5, String(f.months));
  assert.ok(f.six.reached || f.six.months <= 1);
  assert.ok(f.twelve.months >= 5 && f.twelve.months <= 7, JSON.stringify(f.twelve));
  assert.equal(f.fi.goal, 1000000 * 12 * 25);
  assert.ok(f.fi.years > 10 && f.fi.years < 40, String(f.fi.years));
});
