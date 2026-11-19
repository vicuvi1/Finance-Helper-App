// "Subscriptions with their yearly cost": what findSubscriptions finds plus
// your recurring expenses, with what each costs a year. Nothing is cancelled
// or deleted here. Two plain settings fields hold the answers, both
// { key: 'YYYY-MM-DD' } and synced like the other settings:
//   settings.subsKept   = "Still using it? Keep" (the day)
//   settings.subsRemind = "Remind me to cancel" (the day added; a note in the list)

import { findSubscriptions } from './subs.js';
import { perMonth, nextDate, FREQS, describe } from './recurring.js';
import { convert } from './fx.js';
import { addDays } from './dates.js';

const EVERY = Object.fromEntries(FREQS.map((f) => [f.id, f.short]));

export function subscriptionRows(state, today) {
  const cur = state.settings.currency || 'MDL';
  const kept = state.settings.subsKept || {};
  const remind = state.settings.subsRemind || {};
  const rows = [];
  for (const s of findSubscriptions(state, today)) {
    if (s.cancelled) continue;
    rows.push({ key: s.key, name: s.name, every: 'monthly', amount: s.amount, currency: s.currency, yearly: s.yearly, next: s.next, source: 'found' });
  }
  for (const r of state.recurring || []) {
    if (r.type !== 'expense' || r.every === 'once' || r.paused) continue;
    const own = perMonth(r) * 12;
    const yearly = r.currency === cur ? own : convert(own, r.currency, cur, state.rates) ?? own;
    const next = nextDate(r, r.lastDone || addDays(r.start, -1));
    rows.push({ key: `rec:${r.id}`, name: r.note || 'Recurring payment', every: r.every === 'custom' ? describe(r).toLowerCase() : EVERY[r.every] || r.every, amount: r.amount, currency: r.currency, yearly, next, source: 'recurring' });
  }
  for (const x of rows) { x.kept = kept[x.key] || null; x.remind = remind[x.key] || null; }
  rows.sort((a, b) => b.yearly - a.yearly);
  return { rows, total: rows.reduce((a, x) => a + x.yearly, 0), currency: cur };
}

// op: 'keep' | 'unkeep' | 'remind' | 'unremind'. True when something changed.
export function setSubAnswer(state, key, op, today, now = Date.now()) {
  const f = op === 'keep' || op === 'unkeep' ? 'subsKept' : 'subsRemind';
  const next = { ...(state.settings[f] || {}) };
  if (op === 'keep' || op === 'remind') next[key] = today;
  else if (key in next) delete next[key];
  else return false;
  state.settings[f] = next;
  state.settings.updatedAt = now;
  return true;
}
