// Favourites on Money Home: your most common records as one-click buttons.
// Pure (no page, no clock). A favourite is the same type + category + account
// + note; its amount is the one from the most recent matching record. Learned
// from the last 90 days (at least 2 records); pinned ones (settings.favorites,
// the "Pin" button) stay whatever you did lately and come first.

import { addDays } from './dates.js';

export const MAX_FAVS = 6;
const norm = (s) => String(s ?? '').trim().toLowerCase();
export const favKey = (t) => [t.type, t.category || '', t.account || '', norm(t.note)].join('|');
const usable = (t) => (t.type === 'expense' || t.type === 'income') && !t.loan && !t.reconcile && !t.refund && !t.notIncome && !t.notSpending && !String(t.id || '').startsWith('life-reward-');

/** @returns {{ key: string, type: string, category: string, account: string, note: string, sub?: string, amount: number, currency: string, count: number, last: string, pinned: boolean }[]} */
export function rankFavorites(state, today, { n = MAX_FAVS, days = 90 } = {}) {
  const since = addDays(today, -days);
  const pins = (state.settings.favorites || []).filter((f) => f && f.type !== 'transfer');
  const groups = new Map();
  const seen = new Map(); // key -> the latest record of any age (for pinned ones)
  for (const t of state.tx) {
    if (!usable(t) || t.date > today) continue;
    const k = favKey(t);
    const prev = seen.get(k);
    if (!prev || t.date > prev.date || (t.date === prev.date && (t.createdAt || 0) > (prev.createdAt || 0))) seen.set(k, t);
    if (t.date < since) continue;
    const g = groups.get(k) || { count: 0, last: '' };
    g.count++;
    if (t.date > g.last) g.last = t.date;
    groups.set(k, g);
  }
  const make = (src, k, count, last, pinned) => ({
    key: k, type: src.type, category: src.category, account: src.account, note: src.note || '',
    ...(src.sub ? { sub: src.sub } : {}), amount: src.amount, currency: src.currency, count, last, pinned,
  });
  const out = [];
  const used = new Set();
  for (const f of pins) {
    const k = favKey(f);
    if (used.has(k)) continue;
    used.add(k);
    const latest = seen.get(k) || f;
    out.push(make(latest, k, groups.get(k)?.count || 0, groups.get(k)?.last || seen.get(k)?.date || '', true));
  }
  const learned = [...groups.entries()].filter(([k, g]) => g.count >= 2 && !used.has(k))
    .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last));
  for (const [k, g] of learned) out.push(make(seen.get(k), k, g.count, g.last, false));
  return out.slice(0, n);
}

/** Pins a favourite (keeps the newest 12), or unpins it. Returns true when pinned. */
export function togglePin(state, fav, now = Date.now()) {
  const list = state.settings.favorites || [];
  const on = !list.some((f) => favKey(f) === fav.key);
  state.settings.favorites = on
    ? [...list, { type: fav.type, amount: fav.amount, currency: fav.currency, note: fav.note, category: fav.category, account: fav.account, ...(fav.sub ? { sub: fav.sub } : {}) }].slice(-12)
    : list.filter((f) => favKey(f) !== fav.key);
  state.settings.updatedAt = now;
  return on;
}

/** The record one click adds: a favourite as a new record dated `today`. `rate` is the account currency's rate to the main currency. */
export function favTx(fav, today, { id, now, rate }) {
  return {
    id, createdAt: now, updatedAt: now, type: fav.type, amount: fav.amount, currency: fav.currency,
    rate, base: Math.round(fav.amount * rate), date: today, account: fav.account, category: fav.category, note: fav.note,
    ...(fav.sub ? { sub: fav.sub } : {}),
  };
}
