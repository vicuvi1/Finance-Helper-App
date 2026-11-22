import test from 'node:test';
import assert from 'node:assert/strict';
import { toCheck, approve, approveAll } from '../js/tocheck.js';
import { paymentRecord } from '../js/phonepay.js';
import { defaultState } from '../js/model.js';

test('phone payments wait in To check until approved', () => {
  const s = defaultState();
  const r = paymentRecord(s, { text: 'Plata 45 MDL la MADE-UP CAFE' }, { now: 1000, today: '2026-11-22' });
  assert.equal(r.tx.review, true);
  s.tx.push(r.tx, { ...r.tx, id: 'b', note: 'Other', review: true, createdAt: 2000 });
  assert.equal(toCheck(s).length, 2);
  const cat = s.settings.categories.find((c) => c.id !== r.tx.category && (c.type || 'expense') === 'expense').id;
  assert.ok(approve(s, r.tx.id, { category: cat }, 5));
  const t = s.tx.find((x) => x.id === r.tx.id);
  assert.equal(t.category, cat);
  assert.equal(t.review, undefined);
  assert.equal(t.updatedAt, 5);
  assert.equal(approveAll(s, 6), 1);
  assert.equal(toCheck(s).length, 0);
});
