import test from 'node:test';
import assert from 'node:assert/strict';
import { project, addGoal, setInput, planInputs, removeGoal } from '../js/lifeplan.js';
import { defaultState } from '../js/model.js';

const plain = { money: 0, income: 2000000, spending: 1500000, prices: 0, raise: 0, ret: 0, keep: 0 };

test('saving 5 000 a month: a 30 000 goal in 6 months fits, a 100 000 one in a year does not', () => {
  const s = defaultState();
  addGoal(s, { name: 'Made-up car', amount: 3000000, month: '2027-05' }, { id: 'car', now: 1 });
  addGoal(s, { name: 'Made-up flat', amount: 10000000, month: '2027-11' }, { id: 'flat', now: 1 });
  const p = project(s, '2026-11-15', plain);
  const car = p.goals.find((g) => g.id === 'car');
  const flat = p.goals.find((g) => g.id === 'flat');
  assert.equal(car.fits, true);
  assert.equal(car.before, 3000000);
  assert.equal(flat.fits, false);
  assert.equal(flat.fitsAlone, false);
  assert.equal(p.fit, 1);
  assert.ok(flat.earliest > '2027-11');
  // 12 months × 5 000 = 60 000; minus the car 30 000 = 30 000; needs 70 000 more over 12 months.
  assert.ok(flat.extra >= 580000 && flat.extra <= 600000, String(flat.extra));
});

test('prices rising make goals cost more; keeping months aside counts', () => {
  const s = defaultState();
  addGoal(s, { name: 'Made-up trip', amount: 1200000, month: '2027-11' }, { id: 'trip', now: 1 });
  const p1 = project(s, '2026-11-15', { ...plain, prices: 10, spending: 0, income: 100000 });
  assert.ok(p1.goals[0].cost > 1300000);
  // 12 months × 5 000 = 60 000; minus 12 000 = 48 000 left: fine keeping 3 months (45 000), not 4 (60 000).
  assert.equal(project(s, '2026-11-15', { ...plain, keep: 3 }).goals[0].fits, true);
  const g = project(s, '2026-11-15', { ...plain, keep: 4 }).goals[0];
  assert.equal(g.fits, false);
  assert.equal(g.short, 1200000);
});

test('sliders are saved; goals can be removed', () => {
  const s = defaultState();
  setInput(s, 'raise', 7, 5);
  assert.equal(planInputs(s, '2026-11-15').raise, 7);
  addGoal(s, { name: 'x', amount: 100, month: '2027-01' }, { id: 'g', now: 1 });
  assert.equal(removeGoal(s, 'g', 2), true);
});
