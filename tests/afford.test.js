// Can I afford it? (js/afford.js). Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';

test('not this month: when, at the pace of the last 3 months', async () => {
  const { affordCheck } = await import('../js/afford.js');
  const { normalizeState } = await import('../js/model.js');
  const tx = [];
  for (const m of ['08', '09', '10']) {
    tx.push({ id: `in${m}`, type: 'income', amount: 1000000, currency: 'MDL', account: 'cash', category: 'other-in', date: `2026-${m}-02`, createdAt: 1, updatedAt: 1 });
    tx.push({ id: `out${m}`, type: 'expense', amount: 900000, currency: 'MDL', account: 'cash', category: 'food', date: `2026-${m}-05`, createdAt: 1, updatedAt: 1 });
  }
  const s = normalizeState({ tx });
  const r = affordCheck(s, '2026-11-21', { price: 2000000 });
  assert.equal(r.tone, 'bad');
  assert.ok(r.when.months >= 1);
  assert.match(r.when.text, /In about \d+ months? \(/);
});
