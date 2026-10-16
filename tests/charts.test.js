import test from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, sankeyChart, bindSankeyHover } from '../js/charts.js';

test('history charts distinguish rebuilt segments and expose exact dates to keyboard users', () => {
  const html = lineChart([
    { label: 'Aug', date: '2026-08-31', value: 100, snap: false },
    { label: 'Sep', date: '2026-09-25', value: 200, snap: true },
    { label: 'Oct', date: '2026-10-13', value: 300, snap: true },
  ], (v) => `${v} MDL`, { label: 'Net worth over time' });
  assert.equal((html.match(/stroke-dasharray:5 4/g) || []).length, 1);
  assert.equal((html.match(/class="chart-point" tabindex="0"/g) || []).length, 3);
  assert.match(html, /25 Sep 2026: 200 MDL · Actual balance/);
  assert.match(html, /aria-label="Net worth over time"/);
});

test('history charts escape tooltip text and accept one point or no history', () => {
  assert.equal(lineChart([], String), '');
  const html = lineChart([{ label: '<test>', value: 0 }], () => '<value>');
  assert.match(html, /&lt;test&gt;: &lt;value&gt;/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('sankeyChart generates 3-stage Smart Jars flow diagram with ribbons and nodes', () => {
  const data = {
    income: 2000000,
    expense: 800000,
    sources: [
      { id: 'work', name: 'Work Salary', amount: 1600000, color: 'var(--c1)' },
      { id: 'freelance', name: 'Freelance & Side', amount: 400000, color: 'var(--c2)' },
    ],
    jars: [
      { id: 'savings', name: 'Deposit (safe)', emoji: '🏦', pct: 70, savings: true },
      { id: 'living', name: 'Food & transport', emoji: '🍔', pct: 10 },
      { id: 'growth', name: 'Investing & growth', emoji: '📈', pct: 10 },
      { id: 'care', name: 'Hygiene & cosmetics', emoji: '🧴', pct: 10 },
    ],
    categories: [
      { id: 'food', name: 'Food & Dining', amount: 500000, jarId: 'living', color: 'var(--c3)' },
      { id: 'transport', name: 'Transport & Gas', amount: 150000, jarId: 'living', color: 'var(--c4)' },
      { id: 'books', name: 'Books & Courses', amount: 150000, jarId: 'growth', color: 'var(--c5)' },
    ],
  };

  const html = sankeyChart(data, (v) => `${Math.round(v / 100)} MDL`, { mode: 'jars' });
  assert.match(html, /<svg class="chart sankey-chart"/);
  assert.match(html, /SMART JARS/);
  assert.match(html, /Work Salary/);
  assert.match(html, /Deposit \(safe\)/);
  assert.match(html, /Kept in Safe/);
  assert.match(html, /class="sankey-ribbon"/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('sankeyChart generates 2-stage Direct flow when mode is direct', () => {
  const data = {
    income: 1000000,
    expense: 400000,
    sources: [{ id: 'salary', name: 'Salary', amount: 1000000 }],
    categories: [{ id: 'rent', name: 'Rent', amount: 400000 }],
  };

  const html = sankeyChart(data, (v) => `${v}`, { mode: 'direct' });
  assert.match(html, /INFLOWS/);
  assert.match(html, /OUTFLOWS &amp; SAVINGS/);
  assert.match(html, /Salary/);
  assert.match(html, /Rent/);
  assert.match(html, /Kept in Safe/);
  assert.doesNotMatch(html, /SMART JARS/);
});

test('sankeyChart handles deficit gracefully with reserves node', () => {
  const data = {
    income: 500000,
    expense: 900000,
    sources: [{ id: 'salary', name: 'Salary', amount: 500000 }],
    categories: [{ id: 'emergency', name: 'Emergency Repair', amount: 900000 }],
  };

  const html = sankeyChart(data, (v) => `${v}`);
  assert.match(html, /Reserves \/ Deficit/);
  assert.match(html, /Emergency Repair/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('sankeyChart handles empty cash flow without throwing', () => {
  assert.match(sankeyChart({ income: 0, expense: 0 }, String), /No cash flow recorded/);
  assert.match(sankeyChart(null, String), /No cash flow recorded/);
  assert.equal(typeof bindSankeyHover, 'function');
});

test('sankeyChart escapes XSS and special characters in node names', () => {
  const data = {
    income: 100000,
    expense: 0,
    sources: [{ id: 'xss', name: '<script>alert(1)</script>', amount: 100000 }],
  };
  const html = sankeyChart(data, String);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('reports screen embeds interactive cash flow sankey flowchart', async () => {
  const { ctx } = await import('../js/ctx.js');
  const { defaultState } = await import('../js/model.js');
  const ReportsScreen = await import('../js/screens/reports.js');
  ctx.state = defaultState();
  ctx.money = (v) => `${v}`;
  ctx.countUp = (v) => `${v}`;
  ctx.catColor = () => 'var(--c1)';
  ctx.dot = () => '';
  ctx.tipCard = () => '';
  const viewHtml = ReportsScreen.view();
  assert.match(viewHtml, /rep-sankey-card/);
  assert.match(viewHtml, /Cash flow flowchart/);
  assert.match(viewHtml, /rep-sankey-mode/);
  assert.match(viewHtml, /rep-kpi-grid/);
  assert.match(viewHtml, /rep-row-visuals/);
  assert.match(viewHtml, /rep-row-tables/);
});

test('reports screen handles deficit cleanly without negative savings percentages', async () => {
  const { ctx } = await import('../js/ctx.js');
  const { defaultState } = await import('../js/model.js');
  const ReportsScreen = await import('../js/screens/reports.js');
  const st = defaultState();
  // Earn 200, spend 800 -> deficit of 600
  const d = new Date().toISOString().slice(0, 10);
  st.tx = [
    { id: 't1', date: d, amount: 20000, type: 'income', category: 'work', account: 'wallet' },
    { id: 't2', date: d, amount: 80000, type: 'expense', category: 'food', account: 'wallet' },
  ];
  ctx.state = st;
  ctx.money = (v) => `${Math.round(v / 100)} MDL`;
  ctx.countUp = (v) => `${Math.round(v / 100)} MDL`;
  ctx.catColor = () => 'var(--c1)';
  ctx.dot = () => '';
  ctx.tipCard = () => '';
  ctx.txRow = (t) => `<div class="tx">${t.id}</div>`;
  const viewHtml = ReportsScreen.view();
  // Should NOT show negative percentage like -300%
  assert.doesNotMatch(viewHtml, /-300%/);
  // Should display 0% with deficit notice and deficit class
  assert.match(viewHtml, />0%<\/b>/);
  assert.match(viewHtml, /Deficit: 600 MDL/);
  assert.match(viewHtml, /rep-kpi-card deficit/);
  assert.match(viewHtml, /Net Deficit/);
});



