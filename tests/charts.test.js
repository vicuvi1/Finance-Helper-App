import test from 'node:test';
import assert from 'node:assert/strict';
import { lineChart } from '../js/charts.js';

test('history charts distinguish rebuilt segments and expose exact dates to keyboard users', () => {
  const html = lineChart([
    { label: 'Aug', date: '2026-08-31', value: 100, snap: false },
    { label: 'Sep', date: '2026-09-25', value: 200, snap: true },
    { label: 'Oct', date: '2026-10-13', value: 300, snap: true },
  ], (v) => `${v} MDL`, { label: 'Net worth over time' });
  assert.equal((html.match(/stroke-dasharray:5 4/g) || []).length, 1);
  assert.equal((html.match(/class="chart-point" tabindex="0"/g) || []).length, 3);
  assert.match(html, /2026-09-25: 200 MDL · Recorded balance/);
  assert.match(html, /aria-label="Net worth over time"/);
});

test('history charts escape tooltip text and accept one point or no history', () => {
  assert.equal(lineChart([], String), '');
  const html = lineChart([{ label: '<test>', value: 0 }], () => '<value>');
  assert.match(html, /&lt;test&gt;: &lt;value&gt;/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
