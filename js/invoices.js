// Clients and invoices (US work): invoices with hours x rate lines, their
// status, the payment record they turn into, and what each client brings
// in per month and per hour. Pure and tested; js/screens/clients.js shows it.

import { addDays } from './dates.js';
import { B } from './model.js';

export const lineAmount = (l) => (Number(l.hours) > 0 && Number.isInteger(l.rate) ? Math.round(Number(l.hours) * l.rate) : Number.isInteger(l.amount) ? l.amount : 0);
export const invoiceTotal = (inv) => (inv.items || []).reduce((a, l) => a + lineAmount(l), 0);
export const invoiceHours = (inv) => (inv.items || []).reduce((a, l) => a + (Number(l.hours) > 0 ? Number(l.hours) : 0), 0);

// draft -> sent -> paid; sent and past the due date = overdue.
export function invoiceStatus(inv, today) {
  if (inv.paidDate) return 'paid';
  if (!inv.sent) return 'draft';
  return inv.due && inv.due < today ? 'overdue' : 'sent';
}

// INV-2026-001, then 002… per year.
export function nextNumber(state, today) {
  const y = today.slice(0, 4);
  const used = (state.invoices || []).map((i) => new RegExp(`^INV-${y}-(\\d+)$`).exec(i.number || '')?.[1]).filter(Boolean).map(Number);
  return `INV-${y}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`;
}

export function newInvoice(state, client, today, { id, now = Date.now(), days = 14 } = {}) {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    number: nextNumber(state, today),
    client: client?.id || null,
    date: today,
    due: addDays(today, days),
    currency: client?.currency || 'USD',
    items: [{ desc: '', hours: '', rate: client?.rate || null, amount: null }],
    note: '',
    sent: false,
    paidDate: null,
    paidTx: null,
  };
}

// The income record for a paid invoice.
export function paymentTx(inv, { id, account, date, rate = 1, category = 'side', amount = invoiceTotal(inv), currency = inv.currency, now = Date.now() }) {
  return { id, createdAt: now, updatedAt: now, type: 'income', amount, currency, rate, base: Math.round(amount * rate), date, category, account, note: `Invoice ${inv.number}`, person: inv.client, invoice: inv.id };
}

// Per client: paid in (main currency), this year, unpaid, hours billed and
// what an hour really earned.
export function clientStats(state, today) {
  const year = today.slice(0, 4);
  const clients = state.people.filter((p) => p.client);
  return clients.map((p) => {
    const income = state.tx.filter((t) => t.type === 'income' && !t.loan && t.person === p.id);
    const invs = (state.invoices || []).filter((i) => i.client === p.id);
    const paid = income.reduce((a, t) => a + B(t), 0);
    const paidYear = income.filter((t) => t.date.startsWith(year)).reduce((a, t) => a + B(t), 0);
    const open = invs.filter((i) => ['sent', 'overdue'].includes(invoiceStatus(i, today)));
    const paidInvs = invs.filter((i) => i.paidDate);
    const hours = paidInvs.reduce((a, i) => a + invoiceHours(i), 0);
    const hourlyBase = paidInvs.filter((i) => invoiceHours(i) > 0).reduce((a, i) => {
      const t = income.find((x) => x.id === i.paidTx);
      return a + (t ? B(t) : 0);
    }, 0);
    const months = new Set(income.map((t) => t.date.slice(0, 7))).size;
    return {
      person: p,
      paid,
      paidYear,
      perMonth: months ? Math.round(paid / months) : 0,
      openCount: open.length,
      open: open.reduce((a, i) => a + invoiceTotal(i), 0),
      openCurrency: open[0]?.currency || p.currency || 'USD',
      overdue: open.filter((i) => invoiceStatus(i, today) === 'overdue').length,
      hours,
      perHour: hours ? Math.round(hourlyBase / hours) : null,
      last: income.map((t) => t.date).sort().at(-1) || null,
    };
  }).sort((a, b) => b.paidYear - a.paidYear || b.paid - a.paid);
}
