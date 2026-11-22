// Streaks: small, honest habits. Pure and tested (tests/streaks.test.js).
//  - logging: days in a row with at least one record (today counts once you log;
//    until then the streak still stands from yesterday)
//  - noSpend: days in a row (up to yesterday) with no everyday spending
// Milestones (7, 14, 30, 60, 100, 365) get a badge in Reports and a word from the bot.
import { addDays } from './dates.js';
import { countsAsSpending } from './catshare.js';
import { isBillCategory } from './model.js';

export const MILESTONES = [7, 14, 30, 60, 100, 365];

export function streaks(state, today) {
  const logged = new Set();
  const spent = new Set();
  for (const t of state.tx || []) {
    if (!t.date) continue;
    logged.add(t.date);
    if (t.type === 'expense' && countsAsSpending(t) && !t.recurring && !isBillCategory(state, t.category)) spent.add(t.date);
  }
  let logging = 0;
  let d = logged.has(today) ? today : addDays(today, -1);
  while (logged.has(d)) { logging++; d = addDays(d, -1); }
  const first = [...logged].sort()[0];
  let noSpend = 0;
  d = addDays(today, -1);
  while (first && d >= first && !spent.has(d)) { noSpend++; d = addDays(d, -1); }
  const badge = (n) => [...MILESTONES].reverse().find((m) => n >= m) || 0;
  return { logging, noSpend, loggedToday: logged.has(today), loggingBadge: badge(logging), noSpendBadge: badge(noSpend) };
}

/** One line for the bot / Reports, or ''. */
export function streakLine(s) {
  const parts = [];
  if (s.logging >= 3) parts.push(`🔥 ${s.logging}-day logging streak${s.loggingBadge && s.logging === s.loggingBadge ? ' — a new milestone!' : ''}`);
  if (s.noSpend >= 2) parts.push(`🌱 ${s.noSpend} no-spend days in a row`);
  return parts.join(' · ');
}
