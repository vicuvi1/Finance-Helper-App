import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { transferPurpose, weekTotals, weekStart } from '../js/logextras.js';

test('what a Move is for', () => {
  const s = normalizeState({ settings: { accounts: [
    { id: 'card', name: 'Made-up card', currency: 'MDL', kind: 'card' }, { id: 'cash', name: 'Wallet', currency: 'MDL', kind: 'cash' },
    { id: 'safe', name: 'Safe', currency: 'MDL', kind: 'cash', savings: true }, { id: 'usd', name: 'USD', currency: 'USD', kind: 'card' },
  ] } });
  const m = (from, to) => transferPurpose(s, { type: 'transfer', from, to });
  assert.equal(m('card', 'safe'), 'To savings');
  assert.equal(m('safe', 'cash'), 'From savings');
  assert.equal(m('card', 'cash'), 'Cash withdrawal');
  assert.equal(m('cash', 'card'), 'Cash deposit');
  assert.equal(m('usd', 'card'), 'Exchange USD → MDL');
  assert.equal(transferPurpose(s, { type: 'expense' }), '');
});

test('a week against a usual week', () => {
  const tx = [];
  for (let w = 1; w <= 8; w++) tx.push({ id: `w${w}`, type: 'expense', amount: 100000, currency: 'MDL', category: 'food', date: `2026-${w < 5 ? '10' : '10'}-${String(1 + w * 3).padStart(2, '0')}`, createdAt: 1, updatedAt: 1 });
  tx.push({ id: 'now', type: 'expense', amount: 150000, currency: 'MDL', category: 'food', date: '2026-11-18', createdAt: 1, updatedAt: 1 });
  const r = weekTotals(normalizeState({ tx }), '2026-11-18');
  assert.equal(weekStart('2026-11-18'), '2026-11-16');
  assert.equal(r.from, '2026-11-16');
  assert.equal(r.to, '2026-11-22');
  assert.equal(r.spent, 150000);
  assert.ok(r.usual > 0);
});
