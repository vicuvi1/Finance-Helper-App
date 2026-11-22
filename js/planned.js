// Planned big expenses: "Car insurance 3 500 MDL in March", "Holiday 15 000 in
// July". Each is spread over the months until then ("put aside 1 200 a month"),
// and what should be put aside by now is held back from Safe to spend, so the
// day it comes, the money is there. Pure and tested (tests/planned.test.js).
//   settings.planned = [{ id, name, amount, currency, month: 'YYYY-MM', from: 'YYYY-MM',
//                         keep: 'spending' | 'savings', updatedAt }]
// keep 'spending': the money stays in your spending accounts, so it is held back.
// keep 'savings': you move it to a savings account yourself; only the plan shows.

import { monthKey, monthsBetween, addMonths } from './dates.js';
import { convert } from './fx.js';
import { knownRates, B } from './model.js';

const fold = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * The record that paid a plan, if logged: an expense in the plan's month (or the month before)
 * of about the same amount (±10%) whose note shares a word with the plan's name.
 */
export function paidRecord(state, p, amountBase) {
  const words = fold(p.name).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const from = `${addMonths(p.month, -1)}-01`;
  const to = `${p.month}-31`;
  return (state.tx || []).find((t) => t.type === 'expense' && t.date >= from && t.date <= to
    && Math.abs(B(t) - amountBase) <= amountBase * 0.1 && words.some((w) => fold(t.note).includes(w))) || null;
}

export const plannedList = (state) => (Array.isArray(state.settings?.planned) ? state.settings.planned : []);

/** One plan's numbers, in the main currency: months, a month, put aside by now, status. */
export function planStatus(state, p, today) {
  const base = state.settings.currency || 'MDL';
  const now = monthKey(today);
  const amount = p.currency === base ? p.amount : convert(p.amount, p.currency, base, knownRates(state)) ?? p.amount;
  const from = p.from && p.from <= p.month ? p.from : now;
  const months = Math.max(1, monthsBetween(from, p.month) + 1);
  const perMonth = Math.ceil(amount / months / 100) * 100;
  const paid = p.paid ? { id: p.paid } : paidRecord(state, p, amount);
  // Paid (logged, or marked paid): nothing is held back any more, even in its own month.
  const done = now > p.month || !!paid;
  const elapsed = done ? months : Math.max(0, Math.min(months, monthsBetween(from, now) + 1));
  const byNow = done ? amount : Math.min(amount, perMonth * elapsed);
  const left = done ? 0 : Math.max(0, monthsBetween(now, p.month) + 1);
  return { ...p, base, amountBase: amount, months, perMonth, byNow, left, done, paidBy: paid?.id || null };
}

/** What Safe to spend keeps back today: the plans kept in spending accounts, what should be put aside by now. */
export function plannedHeld(state, today) {
  return plannedList(state).map((p) => planStatus(state, p, today)).filter((s) => !s.done && (s.keep || 'spending') === 'spending').reduce((a, s) => a + s.byNow, 0);
}

export function addPlan(state, f, { id, now = Date.now(), today }) {
  const p = { id, name: String(f.name || '').trim() || 'Planned expense', amount: Math.max(1, Math.round(f.amount || 0)), currency: f.currency || state.settings.currency || 'MDL', month: f.month, from: monthKey(today), keep: f.keep === 'savings' ? 'savings' : 'spending', updatedAt: now };
  state.settings.planned = [...plannedList(state), p];
  state.settings.updatedAt = now;
  return p;
}

/** Marks a plan paid (or not, with paid = false). */
export function markPlanPaid(state, id, paid = true, { now = Date.now() } = {}) {
  const p = plannedList(state).find((x) => x.id === id);
  if (!p) return false;
  if (paid) p.paid = typeof paid === 'string' ? paid : 'manual'; else delete p.paid;
  p.updatedAt = now;
  state.settings.updatedAt = now;
  return true;
}

export function removePlan(state, id, { now = Date.now() } = {}) {
  const before = plannedList(state).length;
  state.settings.planned = plannedList(state).filter((p) => p.id !== id);
  if (state.settings.planned.length !== before) state.settings.updatedAt = now;
  return state.settings.planned.length !== before;
}
