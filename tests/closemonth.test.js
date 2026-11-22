// Close the month and clean-up suggestions (js/closemonth.js). Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { monthToClose, closeSteps, cleanupSuggestions, closeMonth, isClosed, reopenMonth } from '../js/closemonth.js';

const tx = (id, date, category = 'food', type = 'expense') => ({ id, date, type, amount: 1000, currency: 'MDL', account: 'cash', category, createdAt: 1, updatedAt: 1 });

test('last month is offered on days 1–15 until it is closed', () => {
  const s = normalizeState({ tx: [tx('a', '2026-10-05')] });
  assert.equal(monthToClose(s, '2026-11-03'), '2026-10');
  assert.equal(monthToClose(s, '2026-11-20'), null, 'after the 15th');
  closeMonth(s, '2026-10', 5);
  assert.equal(isClosed(s, '2026-10'), true);
  assert.equal(s.settings.updatedAt, 5, 'synced like any setting');
  assert.equal(monthToClose(s, '2026-11-03'), null);
  reopenMonth(s, '2026-10');
  assert.equal(isClosed(s, '2026-10'), false);
});

test('the checklist: records in "Other" are counted', () => {
  const s = normalizeState({ tx: [tx('a', '2026-10-05', 'other'), tx('b', '2026-10-06')] });
  const steps = closeSteps(s, '2026-10', '2026-11-03');
  const other = steps.find((x) => x.id === 'other');
  assert.equal(other.done, false);
  assert.match(other.text, /1 record/);
  assert.deepEqual(steps.map((x) => x.id), ['accounts', 'other', 'subs', 'recap']);
});

test('clean-up: a category unused for a year, a forgotten subscription, an idle account', () => {
  const list = [];
  for (let i = 0; i < 60; i++) list.push(tx(`t${i}`, '2026-11-01'));
  list.push(tx('old', '2025-06-01', 'food', 'expense'));
  const s = normalizeState({ tx: list, recurring: [{ id: 's1', type: 'expense', subscription: true, note: 'Made-up Music', amount: 5000, currency: 'MDL', every: 'month', start: '2026-06-01' }] });
  s.settings.accounts.push({ id: 'idle', name: 'Made-up idle', currency: 'MDL', kind: 'card' });
  s.tx.push({ ...tx('idle1', '2026-01-10'), account: 'idle' });
  const c = cleanupSuggestions(s, '2026-11-22');
  assert.ok(c.some((x) => x.kind === 'category'), 'categories never used show');
  assert.ok(c.some((x) => x.id === 'sub:s1'));
  assert.ok(c.some((x) => x.id === 'acc:idle'));
  s.settings.cleanupHidden = { 'sub:s1': 1 };
  assert.equal(cleanupSuggestions(s, '2026-11-22').some((x) => x.id === 'sub:s1'), false, '"Keep it" hides it');
});
