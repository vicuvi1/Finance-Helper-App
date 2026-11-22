import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { streaks, streakLine } from '../js/streaks.js';

const tx = (id, date, type = 'expense', category = 'food') => ({ id, date, type, amount: 100, currency: 'MDL', account: 'cash', category, createdAt: 1, updatedAt: 1 });

test('logging streak counts days in a row; today counts once you log', () => {
  const list = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'].map((d, i) => tx(`t${i}`, d));
  const s = streaks(normalizeState({ tx: list }), '2026-11-22');
  assert.equal(s.logging, 7, 'still standing until today ends');
  assert.equal(s.loggingBadge, 7);
  assert.match(streakLine(s), /7-day logging streak — a new milestone/);
});

test('no-spend days: transfers and income don\'t break it', () => {
  const list = [tx('a', '2026-11-10'), tx('b', '2026-11-20', 'income', 'other-in'), tx('c', '2026-11-21', 'transfer')];
  const s = streaks(normalizeState({ tx: list }), '2026-11-22');
  assert.equal(s.noSpend, 11, '11 to 21 Nov');
});
