// The life planner (Plan → Life planner): your big goals on a timeline (an apartment, a car,
// a wedding) and whether the money will be there, month by month, with sliders for what comes
// in, what you spend, prices, a yearly raise, the return on savings and how much to keep aside.
// Goal costs are in today's money; prices rising makes them (and your spending) cost more later.
// Pure and tested (tests/lifeplan.test.js); js/screens/lifeplan.js shows it.
//   settings.lifeGoals = [{ id, name, amount (bani, main currency, today's money), month: 'YYYY-MM', updatedAt }]
//   settings.lifePlan  = { income, spending, prices, raise, ret, keep }  (sliders; null = from your records)

import { runway, monthFlows } from './longview.js';
import { monthKey, addMonths, monthsBetween } from './dates.js';

export const lifeGoals = (state) => (Array.isArray(state.settings?.lifeGoals) ? state.settings.lifeGoals : []);

/** What the sliders start from: your last 6 full months and your money now. */
export function baseline(state, today) {
  const rw = runway(state, today);
  const now = monthKey(today);
  const all = monthFlows(state, { to: today });
  // The last 6 full months with records; else the last 12; else this month so far, as a whole month.
  let flows = [...all.entries()].filter(([k, f]) => k < now && k >= addMonths(now, -6) && f.records > 0);
  if (!flows.length) flows = [...all.entries()].filter(([k, f]) => k < now && k >= addMonths(now, -12) && f.records > 0);
  if (!flows.length && all.get(now)?.records) {
    const f = all.get(now);
    const scale = 30 / Math.max(1, Number(today.slice(8, 10)));
    flows = [[now, { income: f.income, spending: Math.round(f.spending * scale), records: f.records }]];
  }
  const n = flows.length || 1;
  return {
    money: Math.max(0, Math.round(rw.liquid)),
    income: Math.round(flows.reduce((a, [, f]) => a + f.income, 0) / n),
    spending: Math.round(flows.reduce((a, [, f]) => a + f.spending, 0) / n),
    months: flows.length,
  };
}

/** The sliders in use: yours where set, else from your records, with sensible defaults. */
export function planInputs(state, today) {
  const b = baseline(state, today);
  const p = state.settings?.lifePlan || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  return {
    money: b.money,
    income: num(p.income, b.income),
    spending: num(p.spending, b.spending),
    prices: num(p.prices, 5), // % a year (Moldova: about 5)
    raise: num(p.raise, 3), // % a year
    ret: num(p.ret, 4), // % a year on what you keep
    keep: num(p.keep, 3), // months of spending kept aside, never spent on goals
    baseline: b,
  };
}

/**
 * Month by month from this month to a year after the last goal (at most 30 years).
 * → { months: [{key, money, paid: [goal ids]}], goals: [{...goal, cost, fits, short, before, after, fitsAlone, earliest, extra}],
 *     fit, total, lowest }
 */
export function project(state, today, inputs = planInputs(state, today), goals = lifeGoals(state)) {
  const now = monthKey(today);
  const sorted = [...goals].filter((g) => g && g.amount > 0 && /^\d{4}-\d{2}$/.test(g.month || '')).sort((a, b) => a.month.localeCompare(b.month));
  const spanOf = (list) => {
    const last = list.reduce((m, g) => (g.month > m ? g.month : m), addMonths(now, 24));
    return Math.min(360, Math.max(24, monthsBetween(now, last) + 13));
  };
  const run = (list, extraPerMonth = 0) => {
    const span = spanOf(list);
    let money = inputs.money;
    const out = [];
    const res = new Map();
    for (let i = 0; i <= span; i++) {
      const key = addMonths(now, i);
      const years = i / 12;
      const grow = (pct) => (1 + pct / 100) ** years;
      if (i > 0) {
        money = money * (1 + inputs.ret / 100 / 12) + inputs.income * grow(inputs.raise) - inputs.spending * grow(inputs.prices) + extraPerMonth;
      }
      const keepAside = inputs.keep * inputs.spending * grow(inputs.prices);
      const paid = [];
      for (const g of list.filter((x) => x.month === key)) {
        const cost = Math.round(g.amount * grow(inputs.prices));
        const before = money;
        money -= cost;
        res.set(g.id, { cost, before: Math.round(before), after: Math.round(money), fits: money >= keepAside, short: Math.max(0, Math.round(keepAside - money)) });
        paid.push(g.id);
      }
      out.push({ key, money: Math.round(money), keep: Math.round(keepAside), paid });
    }
    return { months: out, res };
  };
  const all = run(sorted);
  const goalsOut = sorted.map((g) => {
    const r = all.res.get(g.id);
    const alone = run([g]).res.get(g.id);
    let earliest = null;
    let extra = 0;
    if (!r.fits) {
      // The first month it would fit, the others kept where they are.
      for (let k = 1; k <= 240 && !earliest; k++) {
        const m = addMonths(g.month, k);
        const t = run(sorted.map((x) => (x.id === g.id ? { ...x, month: m } : x)));
        const rr = t.res.get(g.id);
        if (rr && rr.fits && sorted.every((x) => x.id === g.id || t.res.get(x.id)?.fits || !all.res.get(x.id).fits)) earliest = m;
      }
      // How much more a month (from now) makes it fit on time.
      let lo = 0;
      let hi = Math.max(100, r.short);
      for (let s = 0; s < 40 && !run(sorted, hi).res.get(g.id).fits; s++) hi *= 2;
      for (let s = 0; s < 30; s++) { const mid = (lo + hi) / 2; if (run(sorted, mid).res.get(g.id).fits) hi = mid; else lo = mid; }
      extra = Math.ceil(hi / 10000) * 10000;
    }
    return { ...g, ...r, fitsAlone: alone.fits, earliest, extra };
  });
  const lowest = all.months.reduce((m, x) => (x.money < m.money ? x : m), all.months[0]);
  return { months: all.months, goals: goalsOut, fit: goalsOut.filter((g) => g.fits).length, total: goalsOut.length, lowest, inputs };
}

export function addGoal(state, f, { id, now = Date.now() }) {
  const g = { id, name: String(f.name || '').trim() || 'A big goal', amount: Math.max(1, Math.round(f.amount || 0)), month: f.month, updatedAt: now };
  state.settings.lifeGoals = [...lifeGoals(state), g];
  state.settings.updatedAt = now;
  return g;
}

export function updateGoal(state, id, patch, now = Date.now()) {
  const g = lifeGoals(state).find((x) => x.id === id);
  if (!g) return false;
  Object.assign(g, patch, { updatedAt: now });
  state.settings.updatedAt = now;
  return true;
}

export function removeGoal(state, id, now = Date.now()) {
  const before = lifeGoals(state).length;
  state.settings.lifeGoals = lifeGoals(state).filter((g) => g.id !== id);
  state.settings.updatedAt = now;
  return state.settings.lifeGoals.length !== before;
}

/** Saves one slider (null = back to what your records say). */
export function setInput(state, key, value, now = Date.now()) {
  state.settings.lifePlan = { ...(state.settings.lifePlan || {}), [key]: value };
  state.settings.updatedAt = now;
}
