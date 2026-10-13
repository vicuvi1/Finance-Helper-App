import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { mergeStates, toCloud } from '../js/sync.js';
import { createHistory } from '../js/history.js';

function fixture() {
  const s = M.defaultState();
  s.settings.accounts[0].start = 100000;
  s.goals = ['fund', 'trip'].map((id) => ({ id, name: id, target: 500000, account: 'allocated', updatedAt: 0 }));
  s.tx.push({ id: 'pay', type: 'income', account: 'wallet', category: 'work', date: '2026-10-01', amount: 50000, base: 50000, currency: 'MDL', updatedAt: 1 });
  return s;
}
const options = { date: '2026-10-13', now: 10 };
const assign = (s, goalId, amount, extra = {}) => M.allocateToGoals(s, [{ goalId, amount }], { ...options, ...extra });

test('reservations fund separate goals without moving or duplicating account money', () => {
  const s = fixture(), balances = M.accountBalances(s);
  M.allocateToGoals(s, [{ goalId: 'fund', amount: 30000 }, { goalId: 'trip', amount: 20000 }], { ...options, incomeId: 'pay' });
  const summary = M.goalAllocationSummary(s);
  assert.equal(summary.reserved, 50000);
  assert.equal(summary.unallocated, 100000);
  assert.equal(M.goalStatus(s, options.date, s.goals[0]).current, 30000);
  assert.equal(M.goalStatus(s, options.date, s.goals[1]).current, 20000);
  assert.deepEqual(M.accountBalances(s), balances);
  assert.equal(s.tx.length, 1);
  assert.equal(M.normalizeState(JSON.parse(JSON.stringify(s))).goalAllocations.length, 2);
});

test('batch validation is atomic and rejects exhausted income, funds and invalid goals', () => {
  const s = fixture();
  assign(s, 'fund', 40000, { incomeId: 'pay' });
  const before = JSON.stringify(s);
  assert.throws(() => assign(s, 'trip', 11000, { incomeId: 'pay' }), /income/);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => assign(s, 'trip', 110001), /balances/);
  assert.throws(() => M.allocateToGoals(s, [{ goalId: 'trip', amount: 100 }, { goalId: 'missing', amount: 100 }], options), /active/);
  assert.equal(JSON.stringify(s), before);
  for (const amount of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => assign(s, 'trip', amount));
});

test('partial and full release free income capacity and persist sync tombstones', () => {
  const s = fixture();
  const [a] = assign(s, 'fund', 40000, { incomeId: 'pay' });
  M.releaseGoalAllocation(s, a.id, 10000, 20);
  assert.equal(M.goalAllocationSummary(s).byIncome.pay, 30000);
  assign(s, 'trip', 20000, { incomeId: 'pay' });
  M.releaseGoalAllocation(s, a.id, 30000, 30);
  assert.equal(s.deleted[a.id], 30);
  assert.equal(M.goalAllocationSummary(s).reserved, 20000);
  assert.throws(() => M.releaseGoalAllocation(s, a.id, 1));
});

test('edited or deleted incomes and spent balances expose shortages instead of double funding', () => {
  const s = fixture();
  assign(s, 'fund', 40000, { incomeId: 'pay' });
  s.tx[0].amount = s.tx[0].base = 10000;
  assert.equal(M.goalAllocationSummary(s).reserved, 10000);
  assert.equal(M.goalAllocationSummary(s).unfunded, 30000);
  assert.throws(() => assign(s, 'trip', 100), /Review/);
  s.tx = [];
  assert.equal(M.goalAllocationSummary(s).reserved, 0);
  assert.equal(M.goalAllocationSummary(s).unfunded, 40000);
  const cash = fixture(); assign(cash, 'fund', 140000);
  cash.tx.push({ id: 'buy', type: 'expense', amount: 120000, base: 120000, currency: 'MDL', account: 'wallet', category: 'food', date: '2026-10-14' });
  assert.equal(M.goalAllocationSummary(cash).reserved, 30000);
  assert.equal(M.goalAllocationSummary(cash).unfunded, 110000);
});

test('concurrent offline reservations merge independently but cannot fund the same income twice', () => {
  const pc = fixture(), phone = structuredClone(pc);
  assign(pc, 'fund', 40000, { incomeId: 'pay', now: 10 });
  assign(phone, 'trip', 40000, { incomeId: 'pay', now: 20 });
  const merged = mergeStates(pc, toCloud(phone, 'phone')).state;
  const summary = M.goalAllocationSummary(merged);
  assert.equal(merged.goalAllocations.length, 2);
  assert.deepEqual(summary.byGoal, { fund: 40000, trip: 10000 });
  assert.equal(summary.unfunded, 30000);
  const reverse = mergeStates(phone, toCloud(pc, 'pc')).state;
  assert.deepEqual(M.goalAllocationSummary(reverse), summary);
  assert.equal(mergeStates(merged, toCloud(merged, 'pc')).pullChanged, false);
});

test('undo and redo preserve both reservation records and changed tracking mode', () => {
  const s = fixture(); s.goals[0].account = 'all';
  const h = createHistory(); h.reset(s);
  assign(s, 'fund', 10000); h.record(s);
  assert.equal(s.goals[0].account, 'allocated');
  h.undo(s);
  assert.equal(s.goalAllocations.length, 0);
  assert.equal(s.goals[0].account, 'all');
  h.redo(s);
  assert.equal(M.goalAllocationSummary(s).reserved, 10000);
  assert.equal(s.goals[0].account, 'allocated');
});

test('legacy goals migrate without inventing reservations; crypto and archived balances are excluded', () => {
  const s = fixture();
  const legacy = M.normalizeState({ ...s, version: 2, goalAllocations: undefined });
  assert.deepEqual(legacy.goalAllocations, []);
  s.settings.accounts.push({ id: 'coin', currency: 'MDL', kind: 'crypto', start: 900000 }, { id: 'old', currency: 'MDL', archived: true, start: 900000 });
  assert.equal(M.goalAllocationSummary(s).cash, 150000);
});

test('historical progress starts on reservation date, completed goals retain funds, and deletion releases via sync', () => {
  const s = fixture(); const [a] = assign(s, 'fund', 10000);
  assert.equal(M.goalAllocationSummary(s, '2026-10-12').reserved, 0);
  assert.equal(M.goalAllocationSummary(s, '2026-10-13').reserved, 10000);
  s.goals[0].doneAt = 20;
  assert.equal(M.goalAllocationSummary(s).reserved, 10000);
  assert.throws(() => assign(s, 'fund', 100));
  const old = structuredClone(s);
  M.releaseGoalAllocation(s, a.id, a.amount, 50);
  assert.equal(mergeStates(old, toCloud(s, 'pc')).state.goalAllocations.length, 0);
});
test('foreign income is capped at its recorded base value; unknown reservation rates block reallocation', () => {
  const s = fixture();
  s.settings.accounts.push({ id: 'usd', currency: 'USD', kind: 'card', start: 0 });
  s.rates = { usd: { USD: 1, MDL: 18 } };
  s.tx[0].account = 'usd';
  s.tx[0].currency = 'USD'; s.tx[0].amount = 10000; s.tx[0].base = 180000;
  assign(s, 'fund', 100000, { incomeId: 'pay' });
  assert.equal(M.goalAllocationSummary(s).byIncome.pay, 100000);
  assert.throws(() => assign(s, 'trip', 80001, { incomeId: 'pay' }), /income/);
  s.goalAllocations[0].currency = 'EUR';
  assert.equal(M.goalAllocationSummary(s).unpriced.length, 1);
  assert.throws(() => assign(s, 'trip', 1), /exchange rates/);
});
