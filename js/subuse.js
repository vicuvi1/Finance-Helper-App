// Cost per use for subscriptions: tap + each time you use one (or tell the bot "used gym"), and
// see what one use costs ("Gym: 300 MDL a visit"). Counts live on the repeating rule as
// rule.uses = { 'YYYY-MM': n } (synced with the rule). Pure and tested (tests/subuse.test.js).

import { monthKey, addMonths } from './dates.js';
import { subscriptionTable } from './subtable.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const usesIn = (rule, key) => Math.max(0, Number(rule?.uses?.[key]) || 0);

/** Adds (or with -1 takes back) one use this month. */
export function addUse(state, ruleId, today, delta = 1, now = Date.now()) {
  const r = (state.recurring || []).find((x) => x.id === ruleId);
  if (!r) return null;
  const key = monthKey(today);
  r.uses = { ...(r.uses || {}), [key]: Math.max(0, usesIn(r, key) + delta) };
  r.updatedAt = now;
  return r.uses[key];
}

/** The subscription a few words name ("gym", "netflix"), or null. */
export function findSub(state, words, today) {
  const w = fold(words).trim();
  if (!w) return null;
  const rows = subscriptionTable(state, today).rows.filter((x) => x.status !== 'paused');
  return (rows.find((x) => fold(x.name) === w) || rows.find((x) => fold(x.name).includes(w) || w.includes(fold(x.name))))?.rule || null;
}

/**
 * Per subscription: monthly cost, uses this month and the 3 before, cost per use, and a verdict.
 * → [{id, name, monthly, uses, avgUses, perUse, verdict, tone}], only ones you counted at least once (or all with `all`).
 */
export function costPerUse(state, today, { all = false } = {}) {
  const key = monthKey(today);
  const day = Number(today.slice(8));
  return subscriptionTable(state, today).rows.filter((x) => x.status !== 'paused' && x.monthly != null).map((x) => {
    const r = x.rule;
    const counted = r.uses && Object.keys(r.uses).length > 0;
    const uses = usesIn(r, key);
    const prev = [1, 2, 3].map((i) => usesIn(r, addMonths(key, -i)));
    const months = prev.filter((n, i) => n > 0 || Object.prototype.hasOwnProperty.call(r.uses || {}, addMonths(key, -(i + 1))));
    const avgUses = months.length ? months.reduce((a, b) => a + b, 0) / months.length : null;
    const base = uses || avgUses || 0;
    const perUse = base > 0 ? Math.round(x.monthly / base) : null;
    let verdict = '';
    let tone = '';
    if (!counted) { verdict = 'Tap + each time you use it'; tone = ''; }
    else if (!uses && day >= 20) { verdict = 'Not used this month: still worth it?'; tone = 'bad'; }
    else if (!uses) { verdict = 'Not used yet this month'; tone = ''; }
    else if (perUse != null && avgUses != null && uses < avgUses / 2 && day >= 20) { verdict = 'Used less than usual'; tone = 'warn'; }
    else { verdict = ''; tone = 'ok'; }
    return { id: r.id, name: x.name, monthly: x.monthly, uses, avgUses, perUse, verdict, tone, counted };
  }).filter((x) => all || x.counted);
}
