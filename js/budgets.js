// More budget kinds (pure, tested). Besides the monthly limit on a category
// (category.budget, model.js budgetStatus, which stays as it is), a budget can
// be weekly, monthly, yearly, or for a date range (a trip or a project), and
// can be narrowed to some categories and/or some #tags in the note. They live
// in settings.budgets (a plain settings key, so it syncs):
//   { id, name, period: 'week'|'month'|'year'|'range', limit (cents, main currency),
//     from, to (range only), cats: [category id], tags: ['trip'], updatedAt }
// What counts is what counts everywhere else: spending records (refunds lower
// it), at the amount in the main currency; "not spending" records and loans
// never count.

import { addDays, daysInMonth, daysBetween, monthKey } from './dates.js';
import { countsAsSpending, signed } from './catshare.js';
import { B, tagsOf } from './model.js';
import { linesOf } from './splits.js';

export const PERIODS = [
  { id: 'week', name: 'Every week', word: "this week's" },
  { id: 'month', name: 'Every month', word: "this month's" },
  { id: 'year', name: 'Every year', word: "this year's" },
  { id: 'range', name: 'Dates (a trip or a project)', word: 'the' },
];

export const budgetsOf = (state) => (Array.isArray(state?.settings?.budgets) ? state.settings.budgets.filter((b) => b && typeof b.id === 'string' && b.limit > 0) : []);

const mondayOf = (iso) => {
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((wd + 6) % 7));
};

/** The dates a budget covers right now: { from, to, tag } (tag names the period, e.g. "w2026-11-16"). */
export function windowOf(b, today) {
  if (b.period === 'week') { const from = mondayOf(today); return { from, to: addDays(from, 6), tag: `w${from}` }; }
  if (b.period === 'year') { const y = today.slice(0, 4); return { from: `${y}-01-01`, to: `${y}-12-31`, tag: `y${y}` }; }
  if (b.period === 'range') return { from: b.from, to: b.to, tag: 'r' };
  const k = monthKey(today);
  return { from: `${k}-01`, to: `${k}-${String(daysInMonth(k)).padStart(2, '0')}`, tag: `m${k}` };
}

/** Does this record belong to the budget's categories / tags? (none picked = everything) */
export function matches(b, t) {
  const cats = Array.isArray(b.cats) ? b.cats : [];
  const tags = Array.isArray(b.tags) ? b.tags.map((x) => String(x).toLowerCase().replace(/^#/, '')) : [];
  if (cats.length && !cats.includes(t.category)) return false;
  if (tags.length) {
    const have = tagsOf(t.note);
    if (!tags.some((g) => have.includes(g))) return false;
  }
  return true;
}

/** Progress of one budget today. level: ok / near (80%+) / over (100%+). status: active / soon (a range not started) / ended. */
export function budgetProgress(state, b, today) {
  const w = windowOf(b, today);
  let spent = 0;
  for (const t of linesOf(state)) { // a split record counts per line (js/splits.js)
    if (t.date < w.from || t.date > w.to || !countsAsSpending(t) || !matches(b, t)) continue;
    spent += signed(t, B(t));
  }
  const pct = b.limit > 0 ? spent / b.limit : 0;
  const status = b.period === 'range' ? (today < w.from ? 'soon' : today > w.to ? 'ended' : 'active') : 'active';
  const level = pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok';
  const daysLeft = status === 'active' ? Math.max(0, daysBetween(today, w.to)) : 0;
  return { budget: b, from: w.from, to: w.to, tag: w.tag, spent, left: b.limit - spent, pct, level, status, daysLeft };
}

/** Every budget's progress, the ones running first. */
export function allProgress(state, today) {
  const order = { active: 0, soon: 1, ended: 2 };
  return budgetsOf(state).map((b) => budgetProgress(state, b, today)).sort((a, b) => order[a.status] - order[b.status] || b.pct - a.pct);
}

/** Active budgets at 80% or more, in the shape budgetwarn.js sends: one per budget and period. */
export function kindCrossings(state, today) {
  const month = monthKey(today);
  const out = [];
  for (const p of allProgress(state, today)) {
    if (p.status !== 'active' || p.level === 'ok') continue;
    const level = p.level === 'over' ? 100 : 80;
    const id = String(p.budget.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'b';
    out.push({
      month,
      // The budget's own period (a week, a year, a trip): the warning is sent once in it, not once a month.
      from: p.from,
      until: p.to,
      cat: `bud-${id}-${p.tag.replace(/[^A-Za-z0-9_-]/g, '')}`,
      name: p.budget.name || 'Budget',
      level,
      pct: Math.floor(p.pct * 100),
      spent: Math.round(p.spent),
      budget: p.budget.limit,
      label: PERIODS.find((x) => x.id === p.budget.period)?.word || 'the',
    });
  }
  return out;
}

/** Makes (or fixes) a budget from form values. Returns { budget } or { error }. */
export function makeBudget(v, { id, now = Date.now() } = {}) {
  const limit = Number(v.limit);
  if (!Number.isSafeInteger(limit) || limit <= 0) return { error: 'Enter a limit bigger than 0.' };
  const period = PERIODS.some((p) => p.id === v.period) ? v.period : 'month';
  const name = String(v.name || '').trim().slice(0, 60);
  if (period === 'range') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(v.to || '')) return { error: 'Pick the first and the last day.' };
    if (v.to < v.from) return { error: 'The last day is before the first.' };
  }
  const cats = [...new Set((v.cats || []).filter((x) => typeof x === 'string'))];
  const tags = [...new Set((v.tags || []).map((x) => String(x).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))].slice(0, 8);
  if (!name && !cats.length && !tags.length) return { error: 'Give it a name, a category or a tag.' };
  const b = { id: id || `bud-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name || (tags.length ? `#${tags[0]}` : 'Budget'), period, limit, cats, tags, updatedAt: now };
  if (period === 'range') { b.from = v.from; b.to = v.to; }
  return { budget: b };
}

/** Saves a budget into settings (adds or replaces by id). */
export function saveBudget(state, b, now = Date.now()) {
  const list = budgetsOf(state).filter((x) => x.id !== b.id);
  state.settings.budgets = [...list, b];
  state.settings.updatedAt = now;
  return b;
}

export function removeBudget(state, id, now = Date.now()) {
  state.settings.budgets = (state.settings.budgets || []).filter((x) => x.id !== id);
  (state.deleted || (state.deleted = {}))[id] = now; // so another device drops it too
  state.settings.updatedAt = now;
}
