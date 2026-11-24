import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneHomeData } from '../js/phonehome.js';
import { defaultState } from '../js/model.js';

test('phone Home numbers: today, the month day by day against a usual month, safety', () => {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  const food = s.settings.categories.find((c) => c.type === 'expense').id;
  const inc = s.settings.categories.find((c) => c.type === 'income').id;
  let n = 0;
  const add = (date, amount, type = 'expense', category = food) => s.tx.push({ id: `t${n++}`, date, type, amount, currency: 'MDL', account: acc, category, note: 'made-up', createdAt: 1, updatedAt: 1 });
  for (const m of ['2026-08', '2026-09', '2026-10']) { add(`${m}-02`, 100000); add(`${m}-20`, 100000); }
  add('2026-11-01', 2000000, 'income', inc);
  add('2026-11-03', 50000);
  add('2026-11-10', 20000);
  const d = phoneHomeData(s, '2026-11-15');
  assert.equal(d.month.line.length, 15);
  assert.equal(d.month.line.at(-1), 70000);
  assert.equal(d.month.usual.length, 30);
  assert.equal(d.month.usual[14], 100000, 'a usual month by the 15th: only the 2nd');
  assert.ok(d.month.vsUsual < 0, 'under a usual month');
  assert.equal(d.month.top[0].id, food);
  assert.ok(Number.isFinite(d.today.left));
  assert.ok(d.today.used >= 0 && d.today.used <= 1);
});
