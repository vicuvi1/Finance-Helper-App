import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, readPayment, paymentRecord, accountFor } from '../js/phonepay.js';
import { defaultState } from '../js/model.js';

test('amounts in any local format', () => {
  assert.equal(parseAmount('120,50'), 12050);
  assert.equal(parseAmount('1 234,56'), 123456);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount('1.200'), 120000);
  assert.equal(parseAmount('120.5'), 12050);
  assert.equal(parseAmount('MDL 45'), 4500);
  assert.equal(parseAmount('abc'), null);
});

test('a bank notification: amount, shop, card; the balance is not the amount', () => {
  const p = readPayment({ text: 'Plata 120,50 MDL la LINELLA SRL, card *4821. Sold: 3 400,00 MDL' });
  assert.deepEqual([p.kind, p.amount, p.currency, p.merchant, p.last4], ['expense', 12050, 'MDL', 'Linella', '4821']);
  const q = readPayment({ text: 'Sold disponibil: 5 000 MDL. Tranzactie 75 lei at Starbucks' });
  assert.equal(q.amount, 7500);
  assert.equal(q.merchant, 'Starbucks');
});

test('codes and declined payments are skipped; money in is income', () => {
  assert.equal(readPayment({ text: 'Codul de confirmare: 123456 pentru plata 500 MDL' }).kind, 'skip');
  assert.equal(readPayment({ text: 'Tranzactie refuzata: fonduri insuficiente 300 MDL' }).kind, 'skip');
  assert.equal(readPayment({ text: 'Alimentare cont +2 000,00 MDL' }).kind, 'income');
  assert.equal(readPayment({ text: 'Hello' }).kind, 'skip');
});

test('iPhone Shortcuts fields', () => {
  const p = readPayment({ amount: '45,00 lei', merchant: 'Andys Pizza', card: 'maib Visa' });
  assert.deepEqual([p.amount, p.currency, p.merchant, p.card], [4500, 'MDL', 'Andys Pizza', 'maib Visa']);
  assert.equal(readPayment({ amount: '$12.99', merchant: 'Apple' }).currency, 'USD');
});

test('a record, on the right card, once', () => {
  const s = defaultState();
  const acc = s.settings.accounts[s.settings.accounts.length - 1];
  acc.last4 = '4821';
  const now = Date.UTC(2026, 10, 22, 10);
  const r = paymentRecord(s, { text: 'Plata 120,50 MDL la LINELLA, card *4821' }, { now, today: '2026-11-22' });
  assert.equal(r.ok, true);
  assert.equal(r.tx.account, acc.id);
  assert.equal(r.tx.amount, 12050);
  assert.equal(r.tx.note, 'Linella');
  assert.equal(r.tx.source, 'phone');
  assert.match(r.tx.id, /^ph-/);
  s.tx.push(r.tx);
  // The SMS and the app notification for the same payment: one record.
  const again = paymentRecord(s, { text: 'Achitare 120.50 MDL LINELLA *4821' }, { now: now + 30000, today: '2026-11-22' });
  assert.equal(again.ok, false);
  assert.equal(again.skip, true);
  assert.equal(accountFor(s, { card: acc.name }), acc.id);
});

test('ask first: a preview saves nothing; confirming with changes saves exactly that', async () => {
  const { paymentPreview } = await import('../js/phonepay.js');
  const s = defaultState();
  const acc = s.settings.accounts[s.settings.accounts.length - 1];
  const other = s.settings.accounts.find((a) => a.id !== acc.id && !a.archived);
  acc.last4 = '4821';
  const at = Date.UTC(2026, 10, 22, 10);
  const pv = paymentPreview(s, { text: 'Plata 120,50 MDL la LINELLA, card *4821', at }, { now: at, today: '2026-11-22' });
  assert.equal(pv.ok, true);
  assert.equal(pv.amount, 12050);
  assert.equal(pv.account, acc.id);
  assert.ok(pv.categories.length > 0 && pv.categories[0].id === pv.category);
  assert.equal(s.tx.length, 0, 'nothing saved');
  const cat = s.settings.categories.find((c) => c.type === 'expense' && c.id !== pv.category);
  const r = paymentRecord(s, { text: 'Plata 120,50 MDL la LINELLA, card *4821', at, confirm: true, category: cat.id, account: other.id, note: 'Groceries', amount_set: 13000 }, { now: at + 60000, today: '2026-11-22' });
  assert.equal(r.ok, true);
  assert.equal(r.tx.category, cat.id);
  assert.equal(r.tx.account, other.id);
  assert.equal(r.tx.note, 'Groceries');
  assert.equal(r.tx.amount, 13000);
  assert.equal(r.tx.review, undefined, 'confirmed: nothing to check');
});
