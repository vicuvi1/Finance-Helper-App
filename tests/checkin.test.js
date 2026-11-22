import test from 'node:test';
import assert from 'node:assert/strict';
import { checkinWeek, isDue, isDone, markDone, checkinData, weekOf } from '../js/checkin.js';
import { defaultState } from '../js/model.js';

test('the week and when it is offered', () => {
  assert.equal(weekOf('2026-11-22'), '2026-11-16'); // a Sunday
  assert.equal(checkinWeek('2026-11-21'), '2026-11-16'); // Saturday
  assert.equal(checkinWeek('2026-11-23'), '2026-11-16'); // Monday: last week
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  for (let i = 0; i < 6; i++) s.tx.push({ id: `t${i}`, date: `2026-11-1${i + 1}`, type: 'expense', amount: 10000, currency: 'MDL', account: acc, category: i < 2 ? 'other' : s.settings.categories.find((c) => c.type === 'expense' && c.id !== 'other').id, note: `made-up ${i}`, createdAt: 1, updatedAt: 1 });
  assert.equal(isDue(s, '2026-11-20'), false, 'not on Friday');
  assert.equal(isDue(s, '2026-11-22'), true);
  const d = checkinData(s, '2026-11-22');
  assert.equal(d.other.length, 2);
  assert.ok(d.review.expense > 0);
  markDone(s, '2026-11-22', 9);
  assert.equal(isDone(s, '2026-11-23'), true, 'Monday counts for the same week');
  assert.equal(isDue(s, '2026-11-23'), false);
  assert.equal(isDue(s, '2026-11-28'), true, 'next weekend again');
});
