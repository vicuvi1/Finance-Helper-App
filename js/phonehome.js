// The numbers behind the phone Home (js/screens/phonehome.js): four swipe screens, one question
// each. Today (can I spend?), This month (how is it going?), Safety (how safe am I?) and What's
// next (filled by the Home steps). Pure and tested (tests/phonehome.test.js).

import { monthKey, addMonths, daysInMonth } from './dates.js';
import { safeToSpend } from './safespend.js';
import { monthSummary, goalStatus, B, category } from './model.js';
import { countsAsSpending, signed } from './catshare.js';
import { emergencyFund } from './emergency.js';
import { upcomingItems } from './recurring.js';

/** Spending added up day by day for a month (up to `lastDay`). */
function running(state, key, lastDay) {
  const per = new Array(lastDay).fill(0);
  for (const t of state.tx || []) {
    if (!t.date?.startsWith(key) || !countsAsSpending(t)) continue;
    const d = Number(t.date.slice(8)) - 1;
    if (d >= 0 && d < lastDay) per[d] += signed(t, B(t));
  }
  let sum = 0;
  return per.map((v) => (sum += v));
}

export function phoneHomeData(state, today) {
  const key = monthKey(today);
  const day = Number(today.slice(8));
  const dim = daysInMonth(key);
  const sf = safeToSpend(state, today);
  const share = Math.max(0, sf.perDay);
  const used = share > 0 ? Math.min(1, Math.max(0, sf.spentToday / share)) : sf.spentToday > 0 ? 1 : 0;
  const bills = upcomingItems(state, today, 31).filter((x) => x.rule.type === 'expense' && (!sf.payday || x.date <= sf.payday)).slice(0, 3);

  const s = monthSummary(state, key);
  const line = running(state, key, day);
  // A usual month: the last 3 months with spending, day by day (to the length of this month).
  const prev = [1, 2, 3].map((i) => addMonths(key, -i)).map((k) => running(state, k, Math.min(dim, daysInMonth(k)))).filter((r) => r.at(-1) > 0);
  const usual = prev.length ? Array.from({ length: dim }, (_, i) => Math.round(prev.reduce((a, r) => a + (r[Math.min(i, r.length - 1)] || 0), 0) / prev.length)) : [];
  const byToday = usual.length ? usual[Math.min(day, usual.length) - 1] : null;
  const top = (s.byCategory || []).filter((c) => c.amount > 0).slice(0, 4).map((c) => ({ id: c.id, name: category(state, c.id)?.name || 'Other', amount: c.amount, share: s.expense > 0 ? c.amount / s.expense : 0 }));

  const ef = emergencyFund(state, today);
  const goals = (state.goals || []).filter((g) => !g.doneAt && !g.archived).slice(0, 3).map((g) => {
    const st = goalStatus(state, today, g);
    return { id: g.id, name: g.name || 'Goal', pct: Math.max(0, Math.min(1, st.ratio || 0)), current: st.current, target: st.target };
  });

  return {
    today: { left: sf.leftToday, share, spent: sf.spentToday, used, payday: sf.payday, empty: sf.pool <= 0, bills },
    month: { key, day, dim, income: s.income, spent: s.expense, kept: s.income - s.expense, rate: s.income > 0 ? (s.income - s.expense) / s.income : null, line, usual, vsUsual: byToday ? (line.at(-1) - byToday) / byToday : null, top },
    safety: { months: ef.ok ? ef.months : null, monthly: ef.monthly, savings: ef.savings, goals },
  };
}
