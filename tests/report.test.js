// Reports for a month or a year (js/report.js). Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { periods, reportData, reportSheets, reportHTML, monthsBetweenKeys } from '../js/report.js';
import { workbook } from '../js/xlsx.js';

let n = 0;
const tx = (date, type, amount, category, note = '') => ({ id: `t${++n}`, date, type, amount, currency: 'MDL', account: 'cash', category, note, createdAt: n, updatedAt: n });
const s = normalizeState({ tx: [
  tx('2026-10-01', 'income', 2000000, 'other-in', 'made-up pay'),
  tx('2026-10-03', 'expense', 300000, 'food', 'made-up food'),
  tx('2026-11-01', 'income', 1000000, 'other-in', 'made-up pay'),
  tx('2026-11-05', 'expense', 100000, 'food', 'made-up food'),
  tx('2026-11-06', 'expense', 100000, 'transport', 'made-up taxi'),
] });

test('the ready periods', () => {
  const p = periods('2026-11-21');
  assert.deepEqual(p.map((x) => [x.from, x.to]), [['2026-11', '2026-11'], ['2026-10', '2026-10'], ['2026-01', '2026-11'], ['2025-01', '2025-12']]);
  assert.equal(monthsBetweenKeys('2026-11', '2027-02').length, 4);
});

test('a two-month report adds up', () => {
  const d = reportData(s, '2026-10', '2026-11', { today: '2026-11-21' });
  assert.equal(d.income, 3000000);
  assert.equal(d.expense, 500000);
  assert.equal(d.kept, 2500000);
  assert.equal(d.records.length, 5);
  assert.equal(d.categories[0].id, 'food');
  assert.equal(d.categories[0].amount, 400000);
  assert.equal(d.months.length, 2);
});

test('Excel and the printable page', () => {
  const d = reportData(s, '2026-11', '2026-11', { today: '2026-11-21' });
  const sheets = reportSheets(s, d);
  assert.deepEqual(sheets.map((x) => x.name), ['Summary', 'Categories', 'Months', 'Subscriptions', 'Accounts', 'Records']);
  assert.equal(sheets[5].rows.length, 4, 'header + 3 records');
  assert.ok(workbook(sheets).length > 1000, 'a real .xlsx file');
  const html = reportHTML(d);
  assert.match(html, /Where the money went/);
  assert.match(html, /10\s000/);
  assert.doesNotMatch(reportHTML(d, { hidden: true }), /10\s000/, 'no amounts while hidden');
});
