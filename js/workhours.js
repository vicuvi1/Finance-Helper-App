// Price in work hours: "this costs you 3.5 hours of work". Your hour is
// what you set yourself, or worked out from paid invoices with hours on
// them, or from your usual monthly income over your working hours.
// Pure; settings.workHour = { mode: 'auto' | 'manual', rate, hoursPerMonth }.

import { B } from './model.js';
import { invoiceHours } from './invoices.js';
import { addMonths, monthKey } from './dates.js';

export const DEFAULT_HOURS = 160; // 8 h × 20 working days

export const workPrefs = (state) => ({ mode: 'auto', rate: 0, hoursPerMonth: DEFAULT_HOURS, show: true, ...(state.settings.workHour || {}) });

// What one hour of your work earns, in your currency (bani), and where it
// comes from. Null when there's nothing to go on.
export function hourlyRate(state, today) {
  const p = workPrefs(state);
  if (p.mode === 'manual') return p.rate > 0 ? { rate: p.rate, source: 'manual' } : null;
  const from = `${addMonths(monthKey(today), -12)}-01`;
  // Invoices with hours that were paid in the last 12 months.
  let hours = 0;
  let paid = 0;
  for (const inv of state.invoices || []) {
    if (!inv.paidDate || inv.paidDate < from) continue;
    const h = invoiceHours(inv);
    const t = h > 0 && state.tx.find((x) => x.id === inv.paidTx);
    if (t) { hours += h; paid += B(t); }
  }
  if (hours >= 10) return { rate: Math.round(paid / hours), source: 'invoices', hours };
  // Otherwise: income of the last 3 full months over your working hours.
  const cur = monthKey(today);
  const months = [1, 2, 3].map((i) => addMonths(cur, -i));
  const income = state.tx.filter((t) => t.type === 'income' && !t.loan && months.includes(t.date.slice(0, 7))).reduce((a, t) => a + B(t), 0);
  const active = new Set(state.tx.filter((t) => t.type === 'income' && !t.loan && months.includes(t.date.slice(0, 7))).map((t) => t.date.slice(0, 7))).size;
  if (!income || !active) return null;
  return { rate: Math.round(income / active / (p.hoursPerMonth || DEFAULT_HOURS)), source: 'income' };
}

// Amount (bani, your currency) -> hours of work.
export const workHours = (amount, rate) => (rate > 0 ? amount / rate : null);

// "12 min", "3.5 h", "2.5 work days" (8 h), "6 work weeks" (40 h).
export function formatWork(h) {
  if (h == null || !Number.isFinite(h)) return '';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const one = (x) => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)).toString().replace('.', ',');
  if (h < 8) return `${one(h)} h`;
  if (h < 40) return `${one(h / 8)} work day${h / 8 >= 1.05 ? 's' : ''}`;
  return `${one(h / 40)} work week${h / 40 >= 1.05 ? 's' : ''}`;
}

// The line for an expense, or '' when it isn't worth saying (no rate, or
// switched off).
export function workText(state, amountBase, today) {
  if (!workPrefs(state).show) return '';
  const r = hourlyRate(state, today);
  if (!r) return '';
  return formatWork(workHours(amountBase, r.rate));
}
