// The buddy's brain (pure, tested): what the little robot says, and its
// mood, when you log something or open the app. js/screens/buddy.js draws it.

import { budgetAlert, category, B, monthSummary, savingsJar, account } from './model.js';
import { loggingStreak } from './review.js';
import { addDays, monthKey } from './dates.js';
import { formatMoney } from './money.js';
import { workText } from './workhours.js';
import { safeToSpend } from './safespend.js';

const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];
const STREAKS = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

const HAPPY = [
  'Logged! Keep it up 💪',
  'Nice, every lei counted.',
  'Done ✓ You\'re in control.',
  'Got it! Tracking is power.',
  'Saved. Future you says thanks.',
  'Another one logged. Smooth!',
];

// Usual spending per day over the last 60 days (base currency).
function usualDaily(state, today) {
  const since = addDays(today, -60);
  const list = state.tx.filter((t) => t.type === 'expense' && !t.loan && t.date >= since && t.date < today);
  return list.length ? list.reduce((a, t) => a + B(t), 0) / 60 : 0;
}

// What the buddy says after a new record. `rand` makes it testable.
export function reactToTx(state, t, today, rand = Math.random) {
  const cur = state.settings.currency;
  const fmt = (c) => formatMoney(Math.round(c / 100) * 100, cur);
  if (t.type === 'transfer') {
    const to = account(state, t.to);
    if (to && (to.savings || to.kind === 'savings')) return { mood: 'proud', text: `Into ${to.name}! That's how wealth grows 🏦` };
    return { mood: 'happy', text: 'Moved. Everything in its place.' };
  }
  if (t.type === 'income') {
    if (t.loan) return { mood: 'happy', text: 'Borrowed money logged. Don\'t forget to pay it back!' };
    const pct = savingsJar(state)?.pct || 0;
    return { mood: 'excited', text: `Money in! +${formatMoney(t.amount, t.currency)} 🎉${pct ? ` Put ${pct}% (${fmt(B(t) * pct / 100)}) in the Safe?` : ''}` };
  }
  const alert = budgetAlert(state, t);
  if (alert?.level === 'over') return { mood: 'worried', text: `Hey, ${category(state, t.category)?.name || 'that'} is over budget now. Be more careful with money 😬` };
  const daily = usualDaily(state, today);
  if (daily > 0 && B(t) >= Math.max(daily * 4, 30000)) {
    const work = workText(state, B(t), today);
    return { mood: 'surprised', text: `Whoa, ${formatMoney(t.amount, t.currency)}!${work ? ` That's ${work} of your work.` : ' That\'s a big one.'} Was it planned?` };
  }
  if (alert?.level === 'near') return { mood: 'thinking', text: `${category(state, t.category)?.name} is at ${alert.text.match(/(\d+)%/)?.[1] || 80}% of its budget. Easy for the rest of the month 🙏` };
  const todaySpent = state.tx.filter((x) => x.type === 'expense' && !x.loan && x.date === today).reduce((a, x) => a + B(x), 0);
  if (daily > 0 && todaySpent > daily * 3 && todaySpent - B(t) <= daily * 3) return { mood: 'worried', text: `Busy spending day: ${fmt(todaySpent)} today. Maybe a no-spend day tomorrow?` };
  const streak = loggingStreak(state, today);
  if (STREAKS.includes(streak) && t.date === today && state.tx.filter((x) => x.date === today).length === 1) return { mood: 'proud', text: `${streak} days in a row! 🔥 That's how you take control.` };
  return { mood: 'happy', text: pick(HAPPY, rand) };
}

// A line for when you open the app or tap the buddy.
export function greeting(state, today, hour, rand = Math.random) {
  const s = monthSummary(state, monthKey(today));
  const target = savingsJar(state)?.pct || 0;
  const loggedToday = state.tx.some((t) => t.date === today);
  const streak = loggingStreak(state, today);
  const options = [];
  if (hour >= 23 || hour < 5) options.push({ mood: 'sleepy', text: 'Still up? Log today\'s spending and get some sleep 😴' });
  if (!loggedToday && hour >= 18) options.push({ mood: 'thinking', text: 'Anything spent today? Tap + and tell me.' });
  if (s.income > 0 && s.savingsRate != null) {
    const p = Math.round(s.savingsRate * 100);
    if (s.net < 0) options.push({ mood: 'worried', text: 'This month more went out than came in. Let\'s slow down a little.' });
    else if (p >= target) options.push({ mood: 'proud', text: `You're keeping ${p}% this month. Above your ${target}%! 🌟` });
    else options.push({ mood: 'thinking', text: `You're keeping ${p}% this month. ${target}% is the goal, you can do it.` });
  }
  if (streak >= 3) options.push({ mood: 'proud', text: `${streak}-day logging streak 🔥 Keep it going!` });
  if (state.tx.length) {
    const sf = safeToSpend(state, today);
    if (sf.leftToday > sf.perDay * 0.75 && sf.perDay > 0 && hour >= 16) {
      options.push({ mood: 'proud', text: `Pacing well today! ${formatMoney(sf.leftToday, state.settings.currency)} safe cushion remaining.` });
    } else if (sf.leftToday < 0) {
      options.push({ mood: 'thinking', text: `Slightly over today's share (${formatMoney(-sf.leftToday, state.settings.currency)}). Tomorrow's allowance adapts automatically.` });
    }
  }
  if (!options.length) options.push({ mood: 'happy', text: hour < 12 ? 'Good morning! Ready to count every lei?' : 'Hi! I\'m watching your money with you 👀' });
  return pick(options, rand);
}
