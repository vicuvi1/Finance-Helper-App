// Planned big expenses (js/planned.js) and Safe to spend. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { addPlan, planStatus, plannedHeld, removePlan } from '../js/planned.js';
import { safeToSpend } from '../js/safespend.js';

const TODAY = '2026-11-21';
const base = () => {
  const s = normalizeState({ tx: [] });
  s.tx.push({ id: 'in', type: 'income', amount: 3000000, currency: 'MDL', account: s.settings.accounts[0].id, category: 'other-in', date: '2026-11-01', createdAt: 1, updatedAt: 1 });
  return s;
};

test('spread over the months until then; put aside by now', () => {
  const s = base();
  const p = addPlan(s, { name: 'Made-up insurance', amount: 360000, month: '2027-03' }, { id: 'p1', today: TODAY });
  const st = planStatus(s, p, TODAY);
  assert.equal(st.months, 5, 'Nov to Mar');
  assert.equal(st.perMonth, 72000);
  assert.equal(st.byNow, 72000, 'this month\'s share');
  assert.equal(planStatus(s, p, '2027-01-10').byNow, 216000);
  assert.equal(planStatus(s, p, '2027-04-01').done, true);
});

test('Safe to spend keeps it back (unless you move it to savings yourself)', () => {
  const s = base();
  const before = safeToSpend(s, TODAY).pool;
  addPlan(s, { name: 'Made-up holiday', amount: 1500000, month: '2027-07' }, { id: 'p1', today: TODAY });
  const sf = safeToSpend(s, TODAY);
  assert.equal(sf.planned, plannedHeld(s, TODAY));
  assert.equal(sf.pool, before - sf.planned);
  addPlan(s, { name: 'Made-up moved', amount: 100000, month: '2027-01', keep: 'savings' }, { id: 'p2', today: TODAY });
  assert.equal(safeToSpend(s, TODAY).planned, sf.planned, 'kept in savings: not held back');
  assert.equal(removePlan(s, 'p1'), true);
  assert.equal(safeToSpend(s, TODAY).pool, before);
});

test('a paid plan is no longer held back, even in its own month', async () => {
  const { defaultState } = await import('../js/model.js');
  const { addPlan, plannedHeld, planStatus, markPlanPaid } = await import('../js/planned.js');
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  addPlan(s, { name: 'Car insurance', amount: 350000, month: '2026-11' }, { id: 'p1', now: 1, today: '2026-09-10' });
  assert.equal(plannedHeld(s, '2026-11-05'), 350000);
  s.tx.push({ id: 't1', date: '2026-11-04', type: 'expense', amount: 340000, currency: 'MDL', account: acc, category: 'other', note: 'Insurance for the car', createdAt: 1, updatedAt: 1 });
  assert.equal(plannedHeld(s, '2026-11-05'), 0);
  assert.equal(planStatus(s, s.settings.planned[0], '2026-11-05').paidBy, 't1');
  s.tx = [];
  markPlanPaid(s, 'p1', true, { now: 2 });
  assert.equal(plannedHeld(s, '2026-11-05'), 0);
  markPlanPaid(s, 'p1', false, { now: 3 });
  assert.equal(plannedHeld(s, '2026-11-05'), 350000);
});
