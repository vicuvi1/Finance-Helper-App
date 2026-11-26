import test from 'node:test';
import assert from 'node:assert/strict';
import { addUse, costPerUse, findSub, usesIn } from '../js/subuse.js';
import { addSubscription } from '../js/subtable.js';
import { defaultState } from '../js/model.js';

test('count uses, cost per use, find by name, a month without use', () => {
  const s = defaultState();
  addSubscription(s, { name: 'Made-up Gym', amount: 60000, currency: 'MDL', every: 'month', next: '2026-12-01' }, { id: 'gym', now: 1, today: '2026-11-05' });
  assert.equal(costPerUse(s, '2026-11-05').length, 0, 'only counted ones by default');
  assert.equal(costPerUse(s, '2026-11-05', { all: true })[0].verdict, 'Tap + each time you use it');
  addUse(s, 'gym', '2026-11-05', 1, 2);
  addUse(s, 'gym', '2026-11-06', 1, 3);
  const r = costPerUse(s, '2026-11-06')[0];
  assert.equal(r.uses, 2);
  assert.equal(r.perUse, 30000);
  assert.equal(s.recurring[0].updatedAt, 3);
  addUse(s, 'gym', '2026-11-06', -1, 4);
  assert.equal(usesIn(s.recurring[0], '2026-11'), 1);
  assert.equal(findSub(s, 'gym', '2026-11-06').id, 'gym');
  assert.match(costPerUse(s, '2026-12-22')[0].verdict, /Not used this month/);
});
