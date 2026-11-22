// Smart warnings (js/smartwarn.js). Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { categoryPace, priceRises, duplicates, staleSubscriptions, smartSteps } from '../js/smartwarn.js';
import { nextSteps } from '../js/nextsteps.js';

const TODAY = '2026-11-20';
let n = 0;
const tx = (date, amount, extra = {}) => ({ id: `t${++n}`, date, type: 'expense', amount, currency: 'MDL', account: 'cash', category: 'food', note: '', createdAt: n, updatedAt: n, ...extra });
const st = (list, extra = {}) => normalizeState({ tx: list, ...extra });

test('a category running well ahead of a usual month', () => {
  const list = [];
  for (const m of ['08', '09', '10']) list.push(tx(`2026-${m}-10`, 300000)); // 3 000 MDL a month on food
  list.push(tx('2026-11-05', 300000), tx('2026-11-15', 200000)); // 5 000 by the 20th (usual by now: 2 000)
  const p = categoryPace(st(list), TODAY);
  assert.equal(p.length, 1);
  assert.equal(p[0].pct, 150);
  assert.equal(p[0].daysLeft, 10);
  assert.equal(categoryPace(st(list), '2026-11-05').length, 0, 'not in the first week');
});

test('a repeating payment that went up', () => {
  const s = st([tx('2026-10-05', 15000, { recurring: 'r1' }), tx('2026-11-05', 19900, { recurring: 'r1' })], { recurring: [{ id: 'r1', type: 'expense', note: 'Made-up Stream', amount: 19900, currency: 'MDL', every: 'month', start: '2026-10-05' }] });
  const r = priceRises(s, TODAY);
  assert.equal(r.length, 1);
  assert.equal(r[0].from, 15000);
  assert.equal(r[0].to, 19900);
});

test('the same thing logged twice', () => {
  const a = tx('2026-11-18', 34000, { note: 'made-up groceries' });
  const b = tx('2026-11-18', 34000, { note: 'Made-up groceries ' });
  const c = tx('2026-11-18', 34000, { note: 'something else' });
  const d = duplicates(st([a, b, c]), TODAY);
  assert.equal(d.length, 1);
  assert.equal(d[0].later.id, b.id);
  assert.equal(duplicates(st([a, b], { settings: { notDuplicates: { [`${a.id}|${b.id}`]: 1 } } }), TODAY).length, 0);
});

test('a subscription with payments not logged for months', () => {
  const s = st([], { settings: {}, recurring: [{ id: 's1', type: 'expense', subscription: true, note: 'Made-up Music', amount: 5000, currency: 'MDL', every: 'month', start: '2026-07-01' }] });
  const r = staleSubscriptions(s, TODAY);
  assert.equal(r.length, 1);
  assert.ok(r[0].missed >= 3);
});

test('they show in "Do this next" with a button that does something', () => {
  const a = tx('2026-11-19', 34000, { note: 'made-up lunch' });
  const b = tx('2026-11-19', 34000, { note: 'made-up lunch' });
  const s = st([a, b]);
  const steps = smartSteps(s, TODAY);
  assert.equal(steps[0].act, 'edit');
  assert.equal(steps[0].data.id, b.id);
  assert.ok(nextSteps(s, TODAY, { demo: true }).some((x) => x.id === `dup:${b.id}`));
});

test('the lowest point ahead: money runs low before the next income', async () => {
  const { lowestPoint } = await import('../js/smartwarn.js');
  const s = normalizeState({ tx: [{ id: 'i', type: 'income', amount: 100000, currency: 'MDL', account: 'cash', category: 'other-in', date: '2026-11-01', createdAt: 1, updatedAt: 1 }],
    recurring: [{ id: 'rent', type: 'expense', note: 'made-up rent', amount: 400000, currency: 'MDL', account: 'cash', every: 'month', start: '2026-11-28', lastDone: '2026-11-21' }] });
  const low = lowestPoint(s, '2026-11-21');
  assert.ok(low);
  assert.equal(low.date, '2026-11-28');
  assert.ok(low.left < 0);
  assert.ok(smartSteps(s, '2026-11-21').some((x) => x.id === 'low:2026-11-28' && x.go === 'calendar'));
});
