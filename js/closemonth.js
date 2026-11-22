// "Close the month" in 5 minutes: a short checklist for last month, then the
// month is marked ✓ checked (settings.closedMonths = { 'YYYY-MM': time }, synced).
// Plus clean-up suggestions (things you don't use any more), each with one action.
// Pure and tested (tests/closemonth.test.js); js/screens/closemonth.js shows it.

import { addMonths, monthKey, monthLabel, daysBetween } from './dates.js';
import { checkupAccounts } from './checkup.js';
import { staleSubscriptions } from './smartwarn.js';
import { activeAccounts, accountBalances } from './model.js';

export const closedMonths = (state) => state.settings?.closedMonths || {};
// A negative time means reopened then (kept so another device's older close doesn't come back).
export const isClosed = (state, key) => Number(closedMonths(state)[key]) > 0;

/** The month to close: last month, until it is closed (then null). Offered on days 1–15. */
export function monthToClose(state, today) {
  const prev = addMonths(monthKey(today), -1);
  if (isClosed(state, prev) || Number(today.slice(8)) > 15) return null;
  if (!(state.tx || []).some((t) => t.date?.startsWith(prev))) return null;
  return prev;
}

const isOther = (t) => !t.category || t.category === 'other' || t.category === 'other-in';

/** The checklist for a month: [{id, title, text, done, btn, act|go, data}]. */
export function closeSteps(state, key, today) {
  const end = `${key}-31`;
  const recs = (state.tx || []).filter((t) => t.date?.startsWith(key));
  const others = recs.filter((t) => t.type !== 'transfer' && isOther(t));
  const accs = checkupAccounts(state, today);
  const checked = accs.filter((x) => x.last && x.last >= `${key}-25`);
  const recapSeen = !!(state.meta?.recapSeen && state.meta.recapSeen[key]) || state.meta?.recapSeen === key;
  return [
    { id: 'accounts', title: 'Check your accounts against the bank', text: accs.length ? `${checked.length} of ${accs.length} checked since the end of ${monthLabel(key).split(' ')[0]}.` : 'No accounts to check.', done: !accs.length || checked.length === accs.length, btn: 'Reality check', go: 'reality' },
    { id: 'other', title: 'File what is still in "Other"', text: others.length ? `${others.length} record${others.length === 1 ? '' : 's'} in ${monthLabel(key)} without a real category.` : 'Every record has a category.', done: !others.length, btn: 'Show them', act: 'cm-other', data: { key } },
    { id: 'subs', title: 'Look at your subscriptions', text: 'Still using each one? Pause or delete the ones you don\'t.', done: !!state.meta?.subsReviewed?.[key], btn: 'Subscriptions', act: 'cm-subs', data: { key } },
    { id: 'recap', title: `See the ${monthLabel(key).split(' ')[0]} recap`, text: 'Where the money went, what went well, one thing to try.', done: recapSeen, btn: 'Open recap', act: 'recap-open', data: { key } },
  ].map((s) => ({ ...s, end }));
}

/**
 * Clean-up suggestions: [{id, kind, title, text, btn, act, data}].
 *  - categories with no record in 12 months (not built in, not archived)
 *  - subscriptions with 3+ payments not logged (cancelled?)
 *  - accounts at 0 with no record in 6 months (archive them)
 */
export function cleanupSuggestions(state, today) {
  const out = [];
  const lastUse = new Map();
  for (const t of state.tx || []) {
    for (const k of [t.category, t.account, t.from, t.to]) if (k && (!lastUse.has(k) || t.date > lastUse.get(k))) lastUse.set(k, t.date);
  }
  const hidden = state.settings?.cleanupHidden || {};
  const BUILT_IN = new Set(['other', 'other-in', 'transfer']);
  for (const c of state.settings.categories || []) {
    if (c.archived || BUILT_IN.has(c.id) || hidden[`cat:${c.id}`]) continue;
    const last = lastUse.get(c.id);
    if (!last || daysBetween(last, today) > 365) {
      if (!last && (state.tx || []).length < 50) continue; // a new install: not "unused" yet
      out.push({ id: `cat:${c.id}`, kind: 'category', title: `${c.emoji ? `${c.emoji} ` : ''}${c.name}: not used ${last ? 'for a year' : 'yet'}`, text: 'Archive it to keep your lists short. Old records keep it; you can bring it back any time.', btn: 'Archive', act: 'cm-archive-cat', data: { id: c.id } });
    }
  }
  for (const s of staleSubscriptions(state, today)) {
    if (hidden[`sub:${s.rule.id}`]) continue;
    out.push({ id: `sub:${s.rule.id}`, kind: 'subscription', title: `${s.name}: ${s.missed} payments not logged`, text: 'Cancelled? Pause it so it stops reminding you and stops counting in your totals.', btn: 'Pause', act: 'cm-pause-sub', data: { id: s.rule.id } });
  }
  const bal = accountBalances(state);
  for (const a of activeAccounts(state)) {
    if (hidden[`acc:${a.id}`]) continue;
    // Only empty ones: an archived account leaves your totals, so one that still holds money (or coins) stays.
    if (bal[a.id] || (a.holdings || []).length) continue;
    const last = lastUse.get(a.id);
    if (last && daysBetween(last, today) > 180) {
      out.push({ id: `acc:${a.id}`, kind: 'account', title: `${a.name}: no records for 6 months`, text: 'If you closed it, archive it. Its history stays.', btn: 'Archive', act: 'cm-archive-acc', data: { id: a.id } });
    }
  }
  return out;
}

export function closeMonth(state, key, now = Date.now()) {
  state.settings.closedMonths = { ...closedMonths(state), [key]: now };
  state.settings.updatedAt = now;
}

export function reopenMonth(state, key, now = Date.now()) {
  state.settings.closedMonths = { ...closedMonths(state), [key]: -now };
  state.settings.updatedAt = now;
}
