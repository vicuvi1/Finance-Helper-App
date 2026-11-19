// Subscription finder: the same payee, a similar amount, roughly once a
// month. Lists what looks like a subscription you never set up as recurring,
// with what it costs a year. Pure; screens/plan.js shows it.
//   settings.subsCancelled = { key: 'YYYY-MM-DD' }  marked as cancelled
//   settings.subsHidden    = { key: true }          "not a subscription"

import { addDays, daysBetween } from './dates.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// The payee from a note: words only (no dates, card numbers or amounts).
export function payeeKey(note) {
  const words = fold(note).replace(/#[\p{L}\p{N}_-]+/gu, ' ').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
  return words.slice(0, 3).join(' ');
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function findSubscriptions(state, today, { minCount = 3, lookbackDays = 400 } = {}) {
  const from = addDays(today, -lookbackDays);
  const cancelled = state.settings.subsCancelled || {};
  const hidden = state.settings.subsHidden || {};
  const haveRec = new Set((state.recurring || []).filter((r) => r.type === 'expense').map((r) => `${payeeKey(r.note)}|${r.currency}`));
  const groups = new Map();
  for (const t of state.tx) {
    if (t.type !== 'expense' || t.loan || t.notSpending || t.recurring || t.date < from || t.date > today) continue;
    const p = payeeKey(t.note);
    if (!p) continue;
    const key = `${p}|${t.currency}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < minCount || haveRec.has(key) || hidden[key]) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const amounts = list.map((t) => t.amount);
    const mid = median(amounts);
    // A similar amount: within 15% of the usual one (prices creep up a bit).
    const similar = list.filter((t) => Math.abs(t.amount - mid) <= mid * 0.15);
    if (similar.length < minCount) continue;
    const gaps = [];
    for (let i = 1; i < similar.length; i++) gaps.push(daysBetween(similar[i - 1].date, similar[i].date));
    const gap = median(gaps);
    // Roughly monthly: 25 to 35 days usually, and no two in the same week.
    if (gap < 25 || gap > 35 || gaps.some((g) => g < 15)) continue;
    const last = similar.at(-1);
    const baseOf = (t) => (Number.isInteger(t.base) ? t.base : t.amount);
    const monthly = median(similar.map(baseOf));
    const cancelledOn = cancelled[key] || null;
    out.push({
      key,
      name: last.note,
      amount: mid,
      currency: last.currency,
      monthly,
      yearly: monthly * 12,
      count: similar.length,
      first: similar[0].date,
      last: last.date,
      next: addDays(last.date, gap),
      category: last.category,
      account: last.account,
      cancelled: !!(cancelledOn && last.date <= cancelledOn),
      cancelledOn: cancelledOn && last.date <= cancelledOn ? cancelledOn : null,
    });
  }
  return out.sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || b.yearly - a.yearly);
}

// "Make recurring": a monthly item from what was found.
export function recurringFrom(sub, now = Date.now(), id = `rec-${now.toString(36)}`) {
  return { id, createdAt: now, updatedAt: now, type: 'expense', amount: sub.amount, currency: sub.currency, account: sub.account, category: sub.category, note: sub.name, every: 'month', start: sub.last, lastDone: sub.last, auto: false, paused: false };
}
