import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nth, occurrences, nextDate, dueItems, upcomingItems, makeTx, markDone, perMonth, suggestions } from '../js/recurring.js';
import { defaultState, normalizeState } from '../js/model.js';
import { mergeStates, toCloud } from '../js/sync.js';
import { addDays, daysBetween } from '../js/dates.js';

const rule = (extra) => ({ id: 'r1', type: 'expense', amount: 500000, currency: 'MDL', account: 'card', category: 'home', note: 'rent', every: 'month', start: '2026-01-31', lastDone: null, auto: false, paused: false, updatedAt: 1, ...extra });

test('dates helpers', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59);
});

test('monthly rules keep the day, clamped to short months', () => {
  const r = rule();
  assert.deepEqual([0, 1, 2, 3].map((n) => nth(r, n)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(occurrences(rule({ every: 'week', start: '2026-03-02' }), '2026-03-01', '2026-03-31'), ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
  assert.deepEqual(occurrences(rule({ every: 'year', start: '2024-02-29' }), '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.deepEqual(occurrences(rule({ every: '3months', start: '2026-01-15', end: '2026-08-01' }), '2026-01-01', '2027-01-01'), ['2026-01-15', '2026-04-15', '2026-07-15']);
  assert.equal(nextDate(rule(), '2026-02-28'), '2026-03-31');
});

test('due and upcoming', () => {
  const s = defaultState();
  s.recurring = [rule({ lastDone: '2026-02-28' }), rule({ id: 'r2', type: 'income', note: 'salary', start: '2026-03-10', amount: 2000000 }), rule({ id: 'r3', paused: true })];
  const due = dueItems(s, '2026-04-05');
  assert.deepEqual(due.map((d) => `${d.rule.id} ${d.date}`), ['r2 2026-03-10', 'r1 2026-03-31']);
  const up = upcomingItems(s, '2026-04-05', 30);
  assert.deepEqual(up.map((d) => `${d.rule.id} ${d.date}`), ['r2 2026-04-10', 'r1 2026-04-30']);
});

test('making a record and marking done', () => {
  const r = rule({ currency: 'USD', amount: 10000 });
  const t = makeTx(r, '2026-03-31', { id: 'x', now: 5, rate: 17.5 });
  assert.equal(t.base, 175000);
  assert.equal(t.recurring, 'r1');
  markDone(r, '2026-03-31', 9);
  markDone(r, '2026-02-28', 10); // older date never moves it back
  assert.equal(r.lastDone, '2026-03-31');
  assert.equal(perMonth(rule({ every: 'year', amount: 120000 })), 10000);
});

test('suggests regular payments, not daily shopping', () => {
  const s = defaultState();
  const tx = (date, note, amount) => ({ id: `${date}${note}`, type: 'expense', amount, date, category: 'other', account: 'card', note });
  for (const m of ['06', '07', '08', '09']) {
    s.tx.push(tx(`2026-${m}-05`, 'Netflix', 19900));
    for (let d = 10; d < 20; d++) s.tx.push(tx(`2026-${m}-${d}`, 'groceries', 10000 + d * 300));
  }
  s.tx.push(tx('2026-07-03', 'gym', 50000), tx('2026-08-03', 'Gym', 50000), tx('2026-09-03', 'gym ', 52000));
  const got = suggestions(s, '2026-09-20').map((x) => x.tx.note.trim().toLowerCase());
  assert.deepEqual(got, ['gym', 'netflix']);
  s.recurring = [rule({ note: 'netflix' })];
  assert.deepEqual(suggestions(s, '2026-09-20').map((x) => x.tx.note.toLowerCase().trim()), ['gym']);
});

test('rules survive normalize and sync', () => {
  const a = normalizeState({ ...defaultState(), recurring: [rule(), { id: 'bad' }] });
  assert.equal(a.recurring.length, 1);
  const b = normalizeState(defaultState());
  b.recurring = [rule({ id: 'r9', note: 'gym', updatedAt: 3 })];
  const { state } = mergeStates(a, toCloud(b, 'phone'));
  assert.deepEqual(state.recurring.map((r) => r.id).sort(), ['r1', 'r9']);
  state.deleted.r1 = 10;
  const again = mergeStates(b, toCloud(state, 'pc'));
  assert.deepEqual(again.state.recurring.map((r) => r.id), ['r9']);
});
