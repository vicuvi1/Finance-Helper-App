// USD rate smarts: is today's dollar rate a good one to convert at? Compares
// today's rate with the last 90 days (saved rate history plus the rates on
// your own records in that currency). Information, not a forecast. Pure.

import { pairRate } from './fx.js';
import { addDays } from './dates.js';

// date -> rate (base per 1 unit of `cur`) over the last `days` days.
export function rateSeries(state, cur, today, days = 90) {
  const base = state.settings.currency;
  const from = addDays(today, -days);
  const out = new Map();
  // Your own records in that currency carry the rate of their day.
  for (const t of state.tx) {
    if (t.currency !== cur || !(t.rate > 0) || t.date < from || t.date > today) continue;
    out.set(t.date, t.rate);
  }
  // Saved history wins (official / market rate of the day).
  for (const [date, usd] of Object.entries(state.rates?.history || {})) {
    if (date < from || date > today) continue;
    const r = pairRate(cur, base, { usd });
    if (r > 0) out.set(date, r);
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, rate]) => ({ date, rate }));
}

// { rate, avg, min, max, pct (0..1, where today sits), verdict, points, series }
// or null with too little history.
export function rateAdvice(state, cur, today, { days = 90 } = {}) {
  const base = state.settings.currency;
  if (cur === base) return null;
  const rate = pairRate(cur, base, state.rates);
  if (!(rate > 0)) return null;
  const series = rateSeries(state, cur, today, days).filter((p) => p.date !== today);
  if (series.length < 5) return { rate, points: series.length, verdict: 'unknown', series };
  const values = series.map((p) => p.rate);
  const avg = values.reduce((a, v) => a + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pct = values.filter((v) => v < rate).length / values.length;
  const verdict = pct >= 0.75 ? 'high' : pct <= 0.25 ? 'low' : 'normal';
  return { rate, avg, min, max, pct, verdict, points: values.length, series: [...series, { date: today, rate }] };
}

// Money you hold in that currency (accounts in it), in its own units (bani).
export function heldIn(state, cur, balances) {
  return state.settings.accounts.filter((a) => !a.archived && a.currency === cur).reduce((a, acc) => a + Math.max(0, balances[acc.id] || 0), 0);
}

// One line for the card / tip.
export function adviceText(a, cur, base) {
  if (!a) return '';
  if (a.verdict === 'unknown') return `Collecting ${cur} rates: advice after a few more days.`;
  const diff = ((a.rate - a.avg) / a.avg) * 100;
  const d = `${Math.abs(diff).toFixed(1).replace('.', ',')}%`;
  if (a.verdict === 'high') return `Good day to convert: 1 ${cur} = ${a.rate.toFixed(2)} ${base}, ${d} above the 90-day average, ${a.pct === 1 ? 'the highest in 90 days' : `higher than on ${Math.round(a.pct * 100)}% of days`}.`;
  if (a.verdict === 'low') return `${cur} is low today: ${a.rate.toFixed(2)} ${base}, ${d} below the 90-day average. If you don't need ${base} now, waiting has usually given more.`;
  return `An ordinary day: 1 ${cur} = ${a.rate.toFixed(2)} ${base}, ${diff >= 0 ? `${d} above` : `${d} below`} the 90-day average.`;
}
