// Emergency fund meter: savings divided by what you must spend in a month.
// Pure (no page, no clock). Savings = the accounts you chose in Settings
// (settings.emergency.accounts), else the accounts marked as savings.
// Monthly essentials = the average of the last 3 full months of spending in
// the categories you marked essential (settings.emergency.essential); with
// none marked, all spending. Refunds, loans, transfers and corrections are
// not spending here. Months before your first record do not count.

import * as M from './model.js';
import { addMonths, monthKey } from './dates.js';
import { countsAsSpending, isRefund } from './catshare.js';
import { linesOf } from './splits.js';

export const MARKS = [3, 6];
export const SCALE_MAX = 8; // the bar is full at 8 months

const cfg = (state) => state.settings.emergency || {};
const isSaving = (a) => a.savings || a.kind === 'savings';

/** Accounts that count as the emergency fund. */
export function fundAccounts(state) {
  const chosen = Array.isArray(cfg(state).accounts) ? cfg(state).accounts : [];
  const active = state.settings.accounts.filter((a) => !a.archived);
  const list = chosen.length ? active.filter((a) => chosen.includes(a.id)) : active.filter(isSaving);
  return { list, own: chosen.length > 0 };
}

/** Categories that count as essential, or null when none is marked (all spending counts). */
export function essentialIds(state) {
  const ids = Array.isArray(cfg(state).essential) ? cfg(state).essential : [];
  const known = ids.filter((id) => state.settings.categories.some((c) => c.id === id));
  return known.length ? new Set(known) : null;
}

/** @returns {{ ok: boolean, months: number, savings: number, monthly: number, basis: 'essential'|'all', counted: number, accounts: string[] }} */
export function emergencyFund(state, today) {
  const { list } = fundAccounts(state);
  const ids = new Set(list.map((a) => a.id));
  const savings = M.accountValues(state).filter((v) => ids.has(v.account.id)).reduce((a, v) => a + Math.max(0, v.inBase ?? 0), 0);
  const ess = essentialIds(state);
  const now = monthKey(today);
  const first = state.tx.reduce((m, t) => (t.date < m ? t.date : m), '9999-99-99').slice(0, 7);
  const keys = [1, 2, 3].map((i) => addMonths(now, -i)).filter((k) => k >= first);
  let total = 0;
  const lines = linesOf(state); // a split record per line (js/splits.js)
  for (const k of keys) {
    for (const t of lines) {
      if (!t.date.startsWith(k) || t.type !== 'expense' || !countsAsSpending(t) || isRefund(t)) continue;
      if (ess && !ess.has(t.category)) continue;
      total += M.B(t);
    }
  }
  const counted = keys.length;
  const monthly = counted ? Math.round(total / counted) : 0;
  const ok = monthly > 0 && counted > 0;
  return { ok, months: ok ? savings / monthly : 0, savings, monthly, basis: ess ? 'essential' : 'all', counted, accounts: list.map((a) => a.name) };
}

/** One line of advice for a number of months. */
export function advice(months) {
  if (months < 1) return 'Start small: build one month of essentials first.';
  if (months < 3) return 'Keep adding until you reach 3 months.';
  if (months < 6) return 'A solid base. 6 months is the comfortable goal.';
  return 'Fully covered. Extra savings can go to your goals.';
}

/** "3.4" (one decimal, "10" from 10 months up). */
export const monthsText = (m) => (m >= 10 ? String(Math.round(m)) : (Math.round(m * 10) / 10).toFixed(1));
