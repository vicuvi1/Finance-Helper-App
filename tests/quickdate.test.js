// Quick add on another day: "yesterday 120 lunch", "120 taxi 12 nov", "2 days ago", "mon".
import test from 'node:test';
import assert from 'node:assert/strict';
import { takeDate, parseQuick } from '../js/quickadd.js';
import { normalizeState } from '../js/model.js';

const TODAY = '2026-11-19'; // a Thursday

test('words for a day back', () => {
  assert.deepEqual(takeDate('yesterday 120 lunch', TODAY), { text: '120 lunch', date: '2026-11-18' });
  assert.deepEqual(takeDate('ieri 40 paine', TODAY), { text: '40 paine', date: '2026-11-18' });
  assert.deepEqual(takeDate('2 days ago 50 bread', TODAY), { text: '50 bread', date: '2026-11-17' });
  assert.equal(takeDate('today 30 coffee', TODAY).date, TODAY);
});

test('a day and a month, either order; a future one means last year', () => {
  assert.deepEqual(takeDate('120 taxi 12 nov', TODAY), { text: '120 taxi', date: '2026-11-12' });
  assert.deepEqual(takeDate('12 nov 300 taxi', TODAY), { text: '300 taxi', date: '2026-11-12' });
  assert.deepEqual(takeDate('nov 3 200 shoes', TODAY), { text: '200 shoes', date: '2026-11-03' });
  assert.deepEqual(takeDate('5 lunch 12 nov', TODAY), { text: '5 lunch', date: '2026-11-12' });
  assert.equal(takeDate('12 dec 120 gift', TODAY).date, '2025-12-12');
  assert.equal(takeDate('3 noiembrie 2025 90 cinema', TODAY).date, '2025-11-03');
  assert.equal(takeDate('2026-11-02 45 bus', TODAY).date, '2026-11-02');
  // A 4-digit number after the day is the amount unless it is a year near today's.
  assert.deepEqual(takeDate('12 nov 4500 rent', TODAY), { text: '4500 rent', date: '2026-11-12' });
  assert.deepEqual(takeDate('nov 12 1500 rent', TODAY), { text: '1500 rent', date: '2026-11-12' });
  assert.deepEqual(takeDate('1 sept 2000 school', TODAY), { text: '2000 school', date: '2026-09-01' });
});

test('weekdays: the latest one, today included', () => {
  assert.equal(takeDate('mon 80 gym', TODAY).date, '2026-11-16');
  assert.equal(takeDate('80 gym thu', TODAY).date, TODAY);
  assert.equal(takeDate('120 lunch sat', TODAY).date, '2026-11-14');
});

test('ordinary text keeps its numbers: amounts are never taken for days', () => {
  assert.deepEqual(takeDate('120 lunch', TODAY), { text: '120 lunch', date: null });
  assert.deepEqual(takeDate('12.5 coffee', TODAY), { text: '12.5 coffee', date: null });
  assert.deepEqual(takeDate('20 mar', TODAY), { text: '20 mar', date: null }, '"mar" is an apple, not March');
  assert.deepEqual(takeDate('50 mai mult', TODAY), { text: '50 mai mult', date: null });
});

test('the quick record goes on that day; the preview knows it is another day', () => {
  const state = normalizeState({ tx: [] });
  const r = parseQuick(state, 'yesterday 120 lunch', { today: TODAY });
  assert.equal(r.ok, true);
  assert.equal(r.tx.date, '2026-11-18');
  assert.equal(r.tx.amount, 12000);
  assert.equal(r.note, 'lunch');
  assert.equal(r.otherDay, true);
  const now = parseQuick(state, '120 lunch', { today: TODAY });
  assert.equal(now.tx.date, TODAY);
  assert.equal(now.otherDay, false);
  assert.equal(parseQuick(state, 'yesterday', { today: TODAY }).ok, false);
});
