import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, takeSnapshot, rebuiltTotal, netWorthSeries, normalizeState } from '../js/model.js';
import { mergeStates, toCloud } from '../js/sync.js';

const tx = (date, type, amount, account = 'wallet') => ({ id: `${date}${type}${amount}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'work' : 'food', account, note: '' });

function state() {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'safe').start = 100000;
  s.tx.push(tx('2026-08-03', 'income', 500000), tx('2026-08-20', 'expense', 100000), tx('2026-09-10', 'income', 300000), tx('2026-10-02', 'expense', 50000));
  return s;
}

test('rebuilds past totals from records', () => {
  const s = state();
  assert.equal(rebuiltTotal(s, '2026-07-31'), 100000);
  assert.equal(rebuiltTotal(s, '2026-08-31'), 500000);
  const series = netWorthSeries(s, '2026-10-09', 12);
  assert.deepEqual(series.map((p) => [p.key, p.value]), [['2026-08', 500000], ['2026-09', 800000], ['2026-10', 750000]]);
});

test('daily snapshots win over rebuilt values and sync by day', () => {
  const s = state();
  assert.equal(takeSnapshot(s, '2026-10-09', 1), true);
  assert.equal(takeSnapshot(s, '2026-10-09', 2), false); // same day, nothing changed
  s.netWorth.push({ id: 'nw-2026-09-15', date: '2026-09-15', total: 790000, crypto: 0, updatedAt: 1 });
  const series = netWorthSeries(s, '2026-10-09');
  assert.equal(series.at(-1).value, 750000); // today: the live total
  assert.equal(series.at(-2).value, 790000); // September: its snapshot
  assert.equal(series.at(-2).snap, true);
  const other = normalizeState(state());
  other.netWorth = [{ id: 'nw-2026-10-08', date: '2026-10-08', total: 740000, crypto: 0, updatedAt: 1 }];
  const merged = mergeStates(s, toCloud(other, 'phone')).state;
  assert.deepEqual(merged.netWorth.map((x) => x.id).sort(), ['nw-2026-09-15', 'nw-2026-10-08', 'nw-2026-10-09']);
});
