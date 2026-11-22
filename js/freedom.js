// The freedom number (Long view): how many months you could live on your money (the runway,
// js/longview.js), when you'd reach 6 and 12 months at the pace you're saving now, and a
// simple "free" projection: the money that would pay your yearly spending for good
// (25 × a year, the 4% rule), and the years to get there with what you keep a month and a
// yearly return you choose (settings.fiReturn, default 5% above inflation).
// Pure and tested (tests/freedom.test.js).

import { runway, monthFlows } from './longview.js';
import { monthKey, addMonths } from './dates.js';

/** Months to grow `have` to `goal` adding `perMonth`, at `yearly` % (null if it never gets there in 100 years). */
export function monthsTo(have, goal, perMonth, yearly = 0) {
  if (have >= goal) return 0;
  const r = Math.max(0, yearly) / 100 / 12;
  let v = have;
  for (let m = 1; m <= 1200; m++) {
    v = v * (1 + r) + perMonth;
    if (v >= goal) return m;
  }
  return null;
}

export function freedom(state, today, { book = null, cur = null } = {}) {
  const rw = runway(state, today, { book, cur });
  const monthly = rw.main?.average || 0;
  const liquid = Math.max(0, rw.liquid);
  // What you kept a month on average: the last 6 full months with records.
  const now = monthKey(today);
  const flows = [...monthFlows(state, { book, to: today, cur }).entries()].filter(([k, f]) => k < now && k >= addMonths(now, -6) && f.records > 0);
  const kept = flows.length ? Math.round(flows.reduce((a, [, f]) => a + f.income - f.spending, 0) / flows.length) : null;
  const yearly = Number(state.settings?.fiReturn ?? 5);
  const months = monthly > 0 ? liquid / monthly : null;
  const when = (target) => {
    if (!monthly) return null;
    const goal = target * monthly;
    if (liquid >= goal) return { reached: true };
    if (kept == null) return { noData: true };
    if (kept <= 0) return { never: true };
    const m = Math.ceil((goal - liquid) / kept);
    return { months: m, month: addMonths(now, m) };
  };
  const fiGoal = monthly * 12 * 25;
  const fiMonths = monthly > 0 && kept > 0 ? monthsTo(liquid, fiGoal, kept, yearly) : null;
  return {
    currency: rw.currency, liquid, monthly, kept, months,
    six: when(6), twelve: when(12),
    fi: monthly > 0 ? { goal: fiGoal, yearly, months: fiMonths, years: fiMonths == null ? null : Math.round((fiMonths / 12) * 10) / 10, share: fiGoal ? liquid / fiGoal : 0 } : null,
  };
}
