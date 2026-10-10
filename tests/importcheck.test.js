import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importRows, importCheck, statedTotals } from '../js/importer.js';
import { parseCSV } from '../js/csv.js';
import { defaultState } from '../js/model.js';

const march = parseCSV(readFileSync(new URL('./fixtures/sample-month.csv', import.meta.url), 'utf8'));

test('a stray row with an amount but no date is the difference', () => {
  const [c] = importCheck([{ name: 'March', ...importRows(march, defaultState()) }]);
  assert.equal(c.app.earned, 2446500);
  assert.equal(c.app.spent, 660500);
  assert.equal(c.ok, false);
  assert.equal(c.diff.earned, 3100000);
  assert.equal(c.diff.spent, 0);
  assert.deepEqual(c.skippedRows, [{ row: 34, label: 'Decembrie', earned: 3100000, spent: 0 }]);
});

test('stated totals and a total row are used; a second import still matches', () => {
  const rows = march.slice(0, 33).map((r) => [...r]);
  rows[4][6] = '24 465MDL'; // PROFIT (this month)
  rows[4][7] = '6 605MDL'; // SPENT (this month)
  assert.deepEqual(statedTotals(rows), { earned: 2446500, spent: 660500 });
  const s = defaultState();
  const first = importRows(rows, s);
  assert.equal(importCheck([first])[0].ok, true);
  s.tx.push(...first.tx);
  const again = importCheck([importRows(rows, s)])[0];
  assert.equal(again.ok, true, 'already-imported records count');
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, first.tx.length);

  const withTotal = [...march.slice(0, 33), ['Total', '24 465', '', '6 605']];
  const t = importCheck([importRows(withTotal, defaultState())])[0];
  assert.equal(t.ok, true);
  assert.equal(t.source.earned, 'total row');
  assert.deepEqual(t.skippedRows, []);
});

test('the stated total disagrees: shown as a difference', () => {
  const rows = march.slice(0, 33).map((r) => [...r]);
  rows[4][6] = '25 000MDL';
  const c = importCheck([importRows(rows, defaultState())])[0];
  assert.equal(c.diff.earned, 53500);
  assert.equal(c.source.earned, 'stated');
});
