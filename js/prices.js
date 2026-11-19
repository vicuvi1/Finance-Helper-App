// Price memory: under the amount of an expense, what the same payee usually
// costs ("Usually 120–150 at Linella (last 3: 148, 132, 141)"), and a quiet
// "Higher than usual" when the new amount is over 20% above the middle one.
// Read only: worked out from your records each time, nothing is stored.

import { payeeKey } from './subs.js';
import { B } from './model.js';
import { isRefund, isPointsReward, isCorrection } from './catshare.js';

const MAX = 8; // the latest records of a payee that count

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};
const whole = (c) => Math.round(c / 100);
const nice = (key) => key.replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/** @returns {null | { payee: string, line: string, high: boolean, median: number, n: number }} */
export function priceMemory(state, note, { amountBase = 0, excludeId = null } = {}) {
  const key = payeeKey(note);
  if (!key) return null;
  const hist = state.tx
    .filter((t) => t.type === 'expense' && !t.loan && !isRefund(t) && !isPointsReward(t) && !isCorrection(t) && t.id !== excludeId && payeeKey(t.note) === key)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)))
    .slice(0, MAX);
  if (hist.length < 2) return null;
  const vals = hist.map((t) => B(t));
  const med = median(vals);
  // With a few records the whole spread, with more the middle half (one odd buy doesn't stretch it).
  const lo = whole(hist.length >= 5 ? pct(vals, 0.25) : Math.min(...vals));
  const hi = whole(hist.length >= 5 ? pct(vals, 0.75) : Math.max(...vals));
  const last = vals.slice(0, 3).map(whole);
  const payee = nice(key);
  const range = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return {
    payee,
    line: `Usually ${range} at ${payee} (last ${last.length}: ${last.join(', ')})`,
    high: hist.length >= 3 && amountBase > med * 1.2,
    median: med,
    n: hist.length,
  };
}
