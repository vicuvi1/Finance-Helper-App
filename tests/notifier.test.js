// The standalone app's own notifications: budget 80% / 100%, the salary
// watch and the check-up reminder, each once, at most 4 a day, no amounts
// while amounts are hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueNotices, PER_DAY } from '../js/notifier.js';
import { normalizeState, SCHEMA_VERSION } from '../js/model.js';

function state() {
  const s = normalizeState({ version: SCHEMA_VERSION, tx: [] });
  const food = s.settings.categories.find((c) => c.type === 'expense');
  food.budget = 100000;
  s.tx.push({ id: 'x1', date: '2026-11-03', type: 'expense', amount: 85000, account: s.settings.accounts[0].id, category: food.id, note: 'made-up', createdAt: 1, updatedAt: 1 });
  return { s, food };
}

test('a budget at 80% warns once; at 100% warns again; hidden amounts show none', () => {
  const { s, food } = state();
  const a = dueNotices(s, '2026-11-10', {});
  assert.deepEqual(a.notices.map((n) => n.key), [`${food.id}:80`, 'checkup']);
  assert.match(a.notices[0].title, /80%/);
  assert.match(a.notices[0].body, /\d/);
  assert.equal(dueNotices(s, '2026-11-10', a.sent).notices.length, 0, 'once');
  s.tx.push({ id: 'x2', date: '2026-11-11', type: 'expense', amount: 20000, account: s.settings.accounts[0].id, category: food.id, note: 'made-up', createdAt: 2, updatedAt: 2 });
  const b = dueNotices(s, '2026-11-11', a.sent, { hidden: true });
  assert.equal(b.notices.length, 1);
  assert.match(b.notices[0].title, /used up/);
  assert.doesNotMatch(b.notices[0].body, /MDL|lei/);
  s.settings.budgetWarn = false;
  assert.ok(dueNotices(s, '2026-11-12', {}).notices.every((n) => n.key === 'checkup'));
});

test('at most a few a day; the rest come later', () => {
  const { s } = state();
  for (const c of s.settings.categories.filter((c) => c.type === 'expense').slice(1, 7)) {
    c.budget = 100;
    s.tx.push({ id: `y-${c.id}`, date: '2026-11-03', type: 'expense', amount: 500, account: s.settings.accounts[0].id, category: c.id, note: 'made-up', createdAt: 1, updatedAt: 1 });
  }
  const a = dueNotices(s, '2026-11-10', {});
  assert.equal(a.notices.length, PER_DAY);
  assert.equal(dueNotices(s, '2026-11-10', a.sent).notices.length, 0);
  assert.ok(dueNotices(s, '2026-11-11', a.sent).notices.length > 0, 'the next day brings the rest');
});

test('a locked (sealed) state sends nothing', () => {
  assert.equal(dueNotices({ _sealed: true }, '2026-11-10', {}).notices.length, 0);
});
