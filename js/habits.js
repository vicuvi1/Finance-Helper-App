// Your spending habits (Reports): which weekdays cost the most, and at what
// time of day you spend (from when a record was logged, when that was on the
// same day). Pure and tested (tests/habits.test.js).

import { addDays, dowIndex, DOW_LONG } from './dates.js';
import { countsAsSpending, signed } from './catshare.js';
import { B, category, isBillCategory } from './model.js';

export const BLOCKS = [
  { id: 'morning', label: 'Morning', hours: '6–12', from: 6, to: 12 },
  { id: 'afternoon', label: 'Afternoon', hours: '12–18', from: 12, to: 18 },
  { id: 'evening', label: 'Evening', hours: '18–22', from: 18, to: 22 },
  { id: 'night', label: 'Late night', hours: '22–6', from: 22, to: 30 },
];
const blockOf = (h) => BLOCKS.find((b) => (h >= b.from && h < b.to) || (h + 24 >= b.from && h + 24 < b.to))?.id || 'night';
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Everyday spending in [from, to] (bills and repeating payments left out: they don't say much about habits). */
function everyday(state, from, to) {
  return (state.tx || []).filter((t) => t.type === 'expense' && t.date >= from && t.date <= to && countsAsSpending(t) && !t.recurring && !isBillCategory(state, t.category));
}

export function spendingMap(state, from, to) {
  const list = everyday(state, from, to);
  const days = [0, 0, 0, 0, 0, 0, 0];
  const spent = [0, 0, 0, 0, 0, 0, 0];
  for (let d = from; d <= to; d = addDays(d, 1)) days[dowIndex(d)]++;
  for (const t of list) spent[dowIndex(t.date)] += signed(t, B(t));
  const totalDays = days.reduce((a, b) => a + b, 0);
  const total = spent.reduce((a, b) => a + b, 0);
  const avgDay = totalDays ? total / totalDays : 0;
  const weekdays = DOW_LONG.map((name, i) => ({ name, perDay: days[i] ? spent[i] / days[i] : 0, ratio: avgDay && days[i] ? spent[i] / days[i] / avgDay : 0 }));

  const blocks = Object.fromEntries(BLOCKS.map((b) => [b.id, 0]));
  const catBlocks = new Map();
  let timed = 0;
  for (const t of list) {
    if (!t.createdAt || localDay(t.createdAt) !== t.date) continue; // logged later: its time says nothing
    const id = blockOf(new Date(t.createdAt).getHours());
    const v = signed(t, B(t));
    blocks[id] += v;
    timed += v;
    const c = catBlocks.get(t.category) || { n: 0, total: 0, by: {} };
    c.n++; c.total += v; c.by[id] = (c.by[id] || 0) + v;
    catBlocks.set(t.category, c);
  }
  const times = BLOCKS.map((b) => ({ ...b, amount: blocks[b.id], share: timed ? blocks[b.id] / timed : 0 }));

  const insights = [];
  const top = [...weekdays].sort((a, b) => b.ratio - a.ratio)[0];
  if (top && top.ratio >= 1.4 && totalDays >= 14) insights.push(`${top.name}s cost you ${top.ratio >= 1.95 ? `${Math.round(top.ratio * 10) / 10}×` : `${Math.round((top.ratio - 1) * 100)}% more than`} a normal day.`);
  const low = [...weekdays].filter((w) => w.perDay > 0 || totalDays >= 14).sort((a, b) => a.ratio - b.ratio)[0];
  if (low && totalDays >= 14 && low.ratio <= 0.5) insights.push(`${low.name}s are your cheapest days.`);
  for (const [cat, c] of catBlocks) {
    if (c.n < 3) continue;
    const [bid, v] = Object.entries(c.by).sort((a, b) => b[1] - a[1])[0];
    if (v / c.total >= 0.6 && (bid === 'night' || bid === 'evening')) {
      const b = BLOCKS.find((x) => x.id === bid);
      insights.push(`Most ${category(state, cat)?.name || 'Other'} spending is in the ${b.label.toLowerCase()} (${b.hours}).`);
    }
  }
  return { weekdays, times, avgDay, total, timed, insights: insights.slice(0, 3), count: list.length };
}
