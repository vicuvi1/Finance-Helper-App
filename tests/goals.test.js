import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, normalizeState, goalStatus, emergencyTarget, goalMessage, mainGoal } from '../js/model.js';

const tx = (date, type, amount, account = 'card') => ({ id: `${date}${type}${amount}${account}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'work' : 'food', account, note: '' });

test('the old single goal becomes the first goal', () => {
  const s = normalizeState({ ...defaultState(), goals: undefined, settings: { ...defaultState().settings, goal: { name: 'Car', target: 5000000, account: 'safe' } } });
  assert.equal(s.goals.length, 1);
  assert.deepEqual([s.goals[0].name, s.goals[0].target, s.goals[0].account], ['Car', 5000000, 'safe']);
  assert.equal(mainGoal(s).name, 'Car');
});

test('savings-only goals, deadlines and milestones', () => {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'safe').start = 3000000; // 30 000 saved
  s.tx.push(tx('2026-07-05', 'income', 1000000), tx('2026-08-05', 'income', 1000000), tx('2026-09-05', 'income', 1000000));
  const goal = { id: 'g1', name: 'Trip', target: 4000000, account: 'savings', deadline: '2026-12-31' };
  const st = goalStatus(s, '2026-10-10', goal);
  assert.equal(st.current, 3000000); // only the Safe counts
  assert.equal(st.milestone, 75);
  assert.equal(st.remaining, 1000000);
  assert.equal(st.deadlineMonths, 3); // Oct, Nov, Dec
  assert.equal(st.perMonth, 333400);
  assert.equal(st.pace, 0); // the safe didn't grow
  assert.equal(st.onTrack, false);
});

test('manual goals use what you added', () => {
  const s = defaultState();
  const goal = { id: 'g2', name: 'Laptop', target: 2000000, account: 'manual', saved: 1200000, history: [{ date: '2026-09-01', amount: 600000 }, { date: '2026-10-01', amount: 600000 }] };
  const st = goalStatus(s, '2026-10-10', goal);
  assert.equal(st.current, 1200000);
  assert.equal(st.pace, 400000); // 12 000 over 3 months
  assert.equal(st.monthsLeft, 2);
  assert.match(goalMessage(st), /Halfway/);
});

test('emergency fund: six months of usual spending', () => {
  const s = defaultState();
  s.tx.push(tx('2026-07-10', 'expense', 900000), tx('2026-08-10', 'expense', 1100000), tx('2026-09-10', 'expense', 1000000));
  assert.equal(emergencyTarget(s, '2026-10-10'), 6000000);
});
