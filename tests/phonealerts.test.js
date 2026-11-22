import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneAlerts } from '../js/phonealerts.js';
import { defaultState } from '../js/model.js';

test('phone alerts: a bill due tomorrow and a budget at 80%, with ids that stay the same', () => {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  const food = s.settings.categories.find((c) => c.type === 'expense');
  food.budget = 100000;
  s.tx.push({ id: 'a', date: '2026-11-10', type: 'expense', amount: 85000, currency: 'MDL', account: acc, category: food.id, note: 'made-up', createdAt: 1, updatedAt: 1 });
  s.tx.push({ id: 'in', date: '2026-11-01', type: 'income', amount: 5000000, currency: 'MDL', account: acc, category: 'other-in', note: 'made-up', createdAt: 1, updatedAt: 1 });
  s.recurring = [{ id: 'rent', type: 'expense', amount: 300000, currency: 'MDL', account: acc, category: 'other', note: 'Made-up rent', every: 'month', start: '2026-11-23', lastDone: '2026-11-22', auto: false, paused: false, updatedAt: 1 }];
  const a = phoneAlerts(s, '2026-11-22');
  const ids = a.map((x) => x.id);
  assert.ok(ids.includes('bill:rent:2026-11-23:soon'), ids.join());
  assert.ok(ids.some((x) => x.startsWith(`budget:${food.id}:2026-11:80`)));
  assert.match(a.find((x) => x.id.startsWith('bill:')).title, /due tomorrow/);
  assert.deepEqual(phoneAlerts(s, '2026-11-22').map((x) => x.id), ids, 'same ids when asked again');
});
