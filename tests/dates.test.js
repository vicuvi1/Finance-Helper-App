import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLooseDate, addMonths, daysInMonth, monthLabel, dayLabel, monthsBetween, isValidISO } from '../js/dates.js';

test('parseLooseDate reads Romanian, English, Russian and numeric dates', () => {
  assert.equal(parseLooseDate('1 martie 2026'), '2026-03-01');
  assert.equal(parseLooseDate('18 februarie 2026'), '2026-02-18');
  assert.equal(parseLooseDate('5 Mai 2026'), '2026-05-05');
  assert.equal(parseLooseDate('3 aprilie 2026'), '2026-04-03');
  assert.equal(parseLooseDate('March 7, 2026'), '2026-03-07');
  assert.equal(parseLooseDate('7 марта 2026'), '2026-03-07');
  assert.equal(parseLooseDate('01.03.2026'), '2026-03-01');
  assert.equal(parseLooseDate('2026-03-31'), '2026-03-31');
  assert.equal(parseLooseDate('31 februarie 2026'), null);
  assert.equal(parseLooseDate('Decembrie'), null);
  assert.equal(parseLooseDate(''), null);
});

test('month math', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-03', 14), '2027-05');
  assert.equal(monthsBetween('2026-03', '2027-01'), 10);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(monthLabel('2026-03'), 'March 2026');
  assert.equal(dayLabel('2026-03-01'), 'Sun, 1 Mar');
  assert.ok(isValidISO('2026-10-09'));
  assert.ok(!isValidISO('2026-13-01'));
});
