import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { spendingMap } from '../js/habits.js';

let n = 0;
const at = (date, hour) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)), hour, 0).getTime();
const tx = (date, amount, category = 'food', hour = 13) => ({ id: `t${++n}`, date, type: 'expense', amount, currency: 'MDL', account: 'cash', category, note: '', createdAt: at(date, hour), updatedAt: 1 });

test('Fridays and late taxis stand out', () => {
  const list = [];
  // Four weeks (2 Nov is a Monday): 100 MDL every day, 400 more on Fridays, taxis at 23:00.
  for (let i = 0; i < 28; i++) {
    const d = new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10);
    list.push(tx(d, 10000));
    if (i % 7 === 4) list.push(tx(d, 40000, 'food', 20));
    if (i % 7 === 5) list.push(tx(d, 8000, 'transport', 23));
  }
  const m = spendingMap(normalizeState({ tx: list }), '2026-11-02', '2026-11-29');
  assert.equal(m.weekdays[4].name, 'Friday');
  assert.ok(m.weekdays[4].ratio > 2.5);
  assert.match(m.insights[0], /^Fridays cost you \d+(\.\d)?× a normal day\.$/);
  assert.ok(m.insights.some((x) => /late night \(22–6\)/.test(x)), m.insights.join(' | '));
  assert.ok(m.times.find((t) => t.id === 'night').amount > 0);
});

test('records logged on a later day don\'t count for the time of day', () => {
  const t = tx('2026-11-02', 5000, 'food', 23);
  t.createdAt = at('2026-11-04', 10);
  const m = spendingMap(normalizeState({ tx: [t] }), '2026-11-01', '2026-11-30');
  assert.equal(m.timed, 0);
});
