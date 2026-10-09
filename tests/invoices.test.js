import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotal, invoiceHours, invoiceStatus, nextNumber, newInvoice, paymentTx, clientStats } from '../js/invoices.js';
import { defaultState, normalizeState } from '../js/model.js';
import { mergeStates, toCloud } from '../js/sync.js';

const client = { id: 'p1', name: 'Acme LLC', client: true, rate: 2500, currency: 'USD', updatedAt: 1 };

test('totals, hours and status', () => {
  const inv = { items: [{ desc: 'Design', hours: '10', rate: 2500 }, { desc: 'Hosting', amount: 5000 }, { desc: '', hours: '', rate: null }], due: '2026-10-15', sent: true };
  assert.equal(invoiceTotal(inv), 30000);
  assert.equal(invoiceHours(inv), 10);
  assert.equal(invoiceStatus(inv, '2026-10-10'), 'sent');
  assert.equal(invoiceStatus(inv, '2026-10-16'), 'overdue');
  assert.equal(invoiceStatus({ ...inv, sent: false }, '2026-10-16'), 'draft');
  assert.equal(invoiceStatus({ ...inv, paidDate: '2026-10-12' }, '2026-10-16'), 'paid');
});

test('numbers count up per year', () => {
  const s = defaultState();
  assert.equal(nextNumber(s, '2026-10-09'), 'INV-2026-001');
  s.invoices = [{ number: 'INV-2026-001' }, { number: 'INV-2026-007' }, { number: 'INV-2025-020' }];
  assert.equal(nextNumber(s, '2026-10-09'), 'INV-2026-008');
  const inv = newInvoice(s, client, '2026-10-09', { id: 'i1', now: 1 });
  assert.equal(inv.due, '2026-10-23');
  assert.equal(inv.items[0].rate, 2500);
});

test('payment record and client stats with real hourly', () => {
  const s = defaultState();
  s.people.push(client);
  const inv = { id: 'i1', number: 'INV-2026-001', client: 'p1', date: '2026-09-01', due: '2026-09-15', currency: 'USD', sent: true, items: [{ hours: '20', rate: 2500 }] };
  const t = paymentTx(inv, { id: 't1', account: 'card', date: '2026-09-10', rate: 17.5, now: 1 });
  assert.equal(t.amount, 50000);
  assert.equal(t.base, 875000);
  assert.equal(t.person, 'p1');
  inv.paidDate = '2026-09-10';
  inv.paidTx = 't1';
  s.tx.push(t);
  s.invoices = [inv, { id: 'i2', client: 'p1', date: '2026-10-01', due: '2026-10-05', sent: true, currency: 'USD', items: [{ amount: 40000 }] }];
  const [st] = clientStats(s, '2026-10-09');
  assert.equal(st.paid, 875000);
  assert.equal(st.hours, 20);
  assert.equal(st.perHour, 43750); // 437,50 MDL an hour
  assert.equal(st.open, 40000);
  assert.equal(st.overdue, 1);
});

test('invoices survive normalize and sync', () => {
  const a = normalizeState({ ...defaultState(), invoices: [{ id: 'i1', date: '2026-10-01', updatedAt: 2 }, { id: 'bad' }] });
  assert.equal(a.invoices.length, 1);
  const b = normalizeState(defaultState());
  b.invoices = [{ id: 'i2', date: '2026-10-02', updatedAt: 3 }];
  assert.deepEqual(mergeStates(a, toCloud(b, 'x')).state.invoices.map((i) => i.id).sort(), ['i1', 'i2']);
});
