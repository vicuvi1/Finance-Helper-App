// Budgets that set themselves: with it on (settings.budgetAuto), on the first day you open the
// app in a new month every category budget becomes the average of your last 3 full months
// (js/budgetsuggest.js, rounded up to 50), and "Do this next" shows what changed, with Undo.
// Categories you set by hand that month keep your number (settings.budgetManual[catId] = 'YYYY-MM').
// Done once a month for all devices (settings.budgetAutoMonth, synced). Pure and tested.

import { monthKey } from './dates.js';
import { suggestBudgets } from './budgetsuggest.js';
import { category, touch } from './model.js';

export const budgetAutoOn = (state) => state.settings?.budgetAuto === true;

/** If it's due this month: sets the budgets and returns the changes [{id, name, from, to}] (else null). */
export function runBudgetAuto(state, today, now = Date.now()) {
  if (!budgetAutoOn(state) || state._sealed) return null;
  const key = monthKey(today);
  if (state.settings.budgetAutoMonth === key) return null;
  const manual = state.settings.budgetManual || {};
  const changes = [];
  for (const r of suggestBudgets(state, today)) {
    if (manual[r.id] === key) continue;
    const c = category(state, r.id);
    if (!c || c.budget === r.suggested) continue;
    changes.push({ id: r.id, name: r.name, emoji: r.emoji, from: c.budget > 0 ? c.budget : 0, to: r.suggested });
    c.budget = r.suggested;
    touch(c, now);
  }
  state.settings.budgetAutoMonth = key;
  state.settings.budgetAutoLast = { month: key, changes };
  state.settings.updatedAt = now;
  return changes;
}

/** Turns it on and sets this month's budgets now. Returns the changes. */
export function startBudgetAuto(state, today, now = Date.now()) {
  state.settings.budgetAuto = true;
  delete state.settings.budgetAutoMonth;
  return runBudgetAuto(state, today, now) || [];
}

export function stopBudgetAuto(state, now = Date.now()) {
  state.settings.budgetAuto = false;
  state.settings.updatedAt = now;
}

/** Puts back the budgets from before this month's automatic change. */
export function undoBudgetAuto(state, now = Date.now()) {
  const last = state.settings.budgetAutoLast;
  if (!last?.changes?.length) return 0;
  for (const ch of last.changes) {
    const c = category(state, ch.id);
    if (!c) continue;
    c.budget = ch.from || 0;
    touch(c, now);
  }
  const n = last.changes.length;
  state.settings.budgetAutoLast = { month: last.month, changes: [], undone: true };
  state.settings.updatedAt = now;
  return n;
}

/** You set a budget by hand: the automatic one leaves that category alone for the rest of the month. */
export function markManual(state, catId, today, now = Date.now()) {
  state.settings.budgetManual = { ...(state.settings.budgetManual || {}), [catId]: monthKey(today) };
  state.settings.updatedAt = now;
}
