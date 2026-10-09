import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, toCSV } from '../js/csv.js';
import { importRows, exportRows, toTSV } from '../js/importer.js';
import {
  defaultState, normalizeState, monthSummary, accountBalances, splitIncome, jarStatus,
  goalStatus, yearOverview, insights, suggestCategory, categoryComparison, trend,
} from '../js/model.js';
import { load, save, restoreJSON, backupJSON } from '../js/store.js';

const march = readFileSync(new URL('./fixtures/sample-month.csv', import.meta.url), 'utf8');

function withMarch() {
  const state = defaultState();
  const res = importRows(parseCSV(march), state);
  state.tx.push(...res.tx);
  return { state, res };
}

let n = 0;
const tx = (type, amount, date, extra = {}) => ({
  id: `t${++n}`, type, amount: amount * 100, date, createdAt: n,
  ...(type === 'transfer' ? {} : { account: 'wallet', category: type === 'income' ? 'work' : 'food' }),
  ...extra,
});

test('importing the March sheet gives the same totals as the sheet', () => {
  const { state, res } = withMarch();
  assert.equal(res.format, 'sheet');
  assert.equal(res.income, 2446500); // PROFIT (this month) 24 465
  assert.equal(res.expense, 660500); // SPENT (this month) 6 605
  assert.deepEqual(res.months, ['2026-03']);
  const s = monthSummary(state, '2026-03');
  assert.equal(s.net, 1786000); // TOTAL 17 860
});

test('import guesses categories from notes', () => {
  const { state } = withMarch();
  const cat = (note) => state.tx.find((t) => t.note === note).category;
  assert.equal(cat('checkers tournament'), 'competitions');
  assert.equal(cat('salary'), 'work');
  assert.equal(cat('from mom'), 'family');
  assert.equal(cat('freelance logo'), 'side');
  assert.equal(cat('gift for sister'), 'gifts');
  assert.equal(cat('karate belt'), 'sport');
  assert.equal(cat('netflix subscription'), 'subscriptions');
  assert.equal(cat('shampoo and soap'), 'hygiene');
  assert.equal(cat('XYZ'), 'other');
  assert.equal(cat('mom asked to buy, gift for'), 'family');
});

test('importing the same file twice adds nothing', () => {
  const { state } = withMarch();
  const again = importRows(parseCSV(march), state);
  assert.equal(again.tx.length, 0);
  assert.equal(again.duplicates, 34);
});

test('app CSV export round-trips through the importer', () => {
  const { state } = withMarch();
  state.tx.push(tx('transfer', 2000, '2026-03-31', { from: 'wallet', to: 'safe' }));
  const csv = toCSV(exportRows(state));
  const fresh = defaultState();
  const res = importRows(parseCSV(csv), fresh);
  assert.equal(res.format, 'app');
  assert.equal(res.tx.length, state.tx.length);
  fresh.tx.push(...res.tx);
  assert.deepEqual(accountBalances(fresh), accountBalances(state));
  assert.equal(importRows(parseCSV(csv), fresh).tx.length, 0);
});

test('a table copied out of the app (names, tabs) pastes back in', () => {
  const { state } = withMarch();
  state.tx.push(tx('transfer', 2000, '2026-03-31', { from: 'wallet', to: 'safe' }));
  const rows = exportRows(state);
  assert.deepEqual(rows[1].slice(0, 6), ['2026-03-01', 'Earned', '200', 'MDL', 'Competitions', 'Wallet']);
  assert.equal(rows.at(-1)[1], 'Move');
  const fresh = defaultState();
  const res = importRows(parseCSV(toTSV(rows)), fresh);
  assert.equal(res.tx.length, state.tx.length);
  fresh.tx.push(...res.tx);
  assert.deepEqual(accountBalances(fresh), accountBalances(state));
  const cats = (s) => s.tx.map((t) => t.category || '').sort().join();
  assert.equal(cats(fresh), cats(state));
});

test('rows pasted straight from the old Google Sheet import too', () => {
  const pasted = '4 martie 2026\t600MDL\tsalary + mom\t240MDL\tfood + bus\n5 martie 2026\t0MDL\t\t150MDL\t';
  const res = importRows(parseCSV(pasted), defaultState());
  assert.equal(res.income, 60000);
  assert.equal(res.expense, 39000);
});

test('balances follow income, expenses and transfers', () => {
  const state = defaultState();
  state.settings.accounts[1].start = 1000000; // 10 000 already in the safe
  state.tx.push(
    tx('income', 3800, '2026-10-01'),
    tx('expense', 300, '2026-10-02'),
    tx('transfer', 2660, '2026-10-02', { from: 'wallet', to: 'safe' }),
  );
  assert.deepEqual(accountBalances(state), { wallet: 84000, safe: 1266000, card: 0 });
});

test('smart split matches the sheet (3800 → 2660 / 380 / 380 / 380)', () => {
  const parts = splitIncome(defaultState(), 380000).map((p) => p.amount);
  assert.deepEqual(parts, [266000, 38000, 38000, 38000]);
});

test('jars: spending jars use income × pct, savings jar measures what you kept', () => {
  const state = defaultState();
  state.tx.push(
    tx('income', 10000, '2026-10-01'),
    tx('expense', 1500, '2026-10-03', { category: 'food' }), // living, budget 1000
    tx('expense', 200, '2026-10-03', { category: 'hygiene' }), // care, budget 1000
  );
  const jars = Object.fromEntries(jarStatus(state, '2026-10').map((j) => [j.jar.id, j]));
  assert.equal(jars.living.budget, 100000);
  assert.equal(jars.living.used, 150000);
  assert.equal(jars.living.left, -50000);
  assert.equal(jars.care.left, 80000);
  assert.equal(jars.savings.used, 830000);
  assert.equal(jars.savings.budget, 700000);
});

test('goal: pace from recent months and an ETA', () => {
  const state = defaultState();
  state.settings.goal.target = 10000000; // 100 000
  for (const m of ['07', '08', '09']) {
    state.tx.push(tx('income', 15000, `2026-${m}-05`), tx('expense', 5000, `2026-${m}-10`));
  }
  const g = goalStatus(state, '2026-10-09');
  assert.equal(g.current, 3000000);
  assert.equal(g.pace, 1000000);
  assert.equal(g.monthsLeft, 7);
  assert.equal(g.eta, '2027-05');

  // A gap of months with no records doesn't count as zero saving.
  const gap = defaultState();
  gap.tx.push(tx('income', 24465, '2026-03-05'), tx('expense', 6605, '2026-03-10'));
  const gg = goalStatus(gap, '2026-10-09');
  assert.equal(gg.pace, 1786000);
  assert.equal(gg.eta, '2027-03');

  state.settings.goal.account = 'safe';
  assert.equal(goalStatus(state, '2026-10-09').current, 0);
});

test('year overview adds up the months', () => {
  const { state } = withMarch();
  const y = yearOverview(state, 2026);
  assert.equal(y.rows.length, 12);
  assert.equal(y.rows[2].income, 2446500);
  assert.equal(y.total.net, 1786000);
  assert.equal(trend(state, '2026-04', 3).map((r) => r.key).join(), '2026-02,2026-03,2026-04');
});

test('insights flag overspending and praise good saving', () => {
  const { state } = withMarch();
  const tips = insights(state, '2026-03', '2026-10-09');
  const titles = tips.map((t) => t.title);
  assert.ok(titles.some((t) => /kept 73% of your income/.test(t)), titles.join(' | '));
  // 3 500 gift + food etc. blow the 10% "food & transport" jar? No: income is
  // 24 465, so that jar has 2 446. Gifts+food+family+other = more than that.
  assert.ok(titles.some((t) => /Food & transport: over by/.test(t)), titles.join(' | '));
  assert.ok(titles.some((t) => /One expense is \d+% of the month/.test(t)));
  assert.ok(titles.some((t) => /no-spend days/.test(t)));
  assert.equal(tips[0].level, 'bad');
});

test('insights for an empty month nudge you to log', () => {
  const tips = insights(defaultState(), '2026-10', '2026-10-09');
  assert.equal(tips.length, 1);
  assert.match(tips[0].title, /Nothing logged/);
});

test('insights spot a category growing vs normal months', () => {
  const state = defaultState();
  for (const m of ['07', '08', '09']) state.tx.push(tx('expense', 1000, `2026-${m}-03`, { category: 'food' }));
  state.tx.push(tx('expense', 2000, '2026-10-03', { category: 'food' }), tx('income', 9000, '2026-10-01'));
  const tips = insights(state, '2026-10', '2026-10-09');
  assert.ok(tips.some((t) => /Food is up 100%/.test(t.title)));
  const cmp = categoryComparison(state, '2026-10');
  assert.equal(cmp[0].avg, 100000);
});

test('suggestCategory prefers your own history over keywords', () => {
  const state = defaultState();
  assert.equal(suggestCategory(state, 'Taxi home', 'expense'), 'transport');
  state.tx.push(tx('expense', 50, '2026-10-01', { note: 'Taxi home', category: 'fun' }));
  assert.equal(suggestCategory(state, 'taxi home', 'expense'), 'fun');
  assert.equal(suggestCategory(state, 'zzz', 'expense'), null);
});

test('storage survives bad data and backups restore', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  mem.set('finance-helper.state', '{broken');
  assert.equal(load(storage).tx.length, 0);
  const { state } = withMarch();
  assert.ok(save(state, storage));
  assert.equal(load(storage).tx.length, state.tx.length);
  const restored = restoreJSON(backupJSON(state));
  assert.equal(restored.tx.length, state.tx.length);
  assert.throws(() => restoreJSON('{"hello":1}'), /not a Finance Helper backup/);
  assert.throws(() => restoreJSON('nope'), /not JSON/);
});

test('normalizeState drops invalid transactions and fills missing settings', () => {
  const s = normalizeState({ tx: [{ id: 'a', type: 'expense', amount: 5, date: '2026-01-01' }, { id: 'b', type: 'x' }], settings: { currency: 'EUR' } });
  assert.equal(s.tx.length, 1);
  assert.equal(s.settings.currency, 'EUR');
  assert.equal(s.settings.jars.length, 4);
});

test('Excel export: a valid .xlsx with one tab per month and formulas', async () => {
  const { workbook, crc32, excelDate, safeSheetName } = await import('../js/xlsx.js');
  const { monthSheet, overviewSheet } = await import('../js/importer.js');
  const zlib = await import('node:zlib');
  const { state } = withMarch();
  const month = monthSheet(state, '2026-03');
  assert.equal(month.rows.length, 1 + 34 + 4);
  assert.equal(month.rows.at(-3)[5].v, 24465);
  assert.equal(month.rows.at(-2)[5].v, 6605);
  assert.match(month.rows.at(-3)[5].f, /^SUMIF\(B2:B35,"Earned",F2:F35\)$/);
  const bytes = workbook([{ name: '2026 Overview', ...overviewSheet(state, 2026) }, { name: 'March 2026', ...month }]);
  // Zip signature, and every stored file's CRC matches Node's own crc32.
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(crc32(new TextEncoder().encode('hello')), zlib.crc32('hello'));
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('<sheet name="March 2026"'));
  assert.ok(text.includes('xl/worksheets/sheet2.xml'));
  assert.equal(excelDate('2026-03-01'), 46082);
  assert.equal(safeSheetName('a/b:c?'), 'a b c');
});
