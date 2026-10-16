// Home's verdict sentence and "Do this next". Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, nextSteps } from '../js/nextsteps.js';
import { defaultState } from '../js/model.js';

const tx = (date, type, amount, extra = {}) => ({ id: `${date}-${type}-${amount}-${Math.random()}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'family' : 'food', account: 'card', note: '', ...extra });

// 20 000 came in on the 1st, 10 000 already on the card; internet due on the 14th.
function state() {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'card').start = 1000000;
  s.tx.push(tx('2026-10-01', 'income', 2000000));
  s.tx.push(tx('2026-10-11', 'expense', 200000));
  s.recurring = [
    { id: 'net', type: 'expense', amount: 15000, currency: 'MDL', account: 'card', category: 'home', note: 'Internet', every: 'month', start: '2026-09-14', lastDone: '2026-09-14' },
    { id: 'pay', type: 'income', amount: 2000000, currency: 'MDL', account: 'card', category: 'family', note: 'retainer', every: 'month', start: '2026-09-20', lastDone: '2026-10-01' },
  ];
  return s;
}

test('verdict: a good month in one sentence', () => {
  const v = verdict(state(), '2026-10-13');
  assert.equal(v.title, 'A good month so far'); // kept 90%, the plan is 70%
  assert.equal(v.tone, 'good');
  assert.equal(v.sub, 'You kept 90% of what came in · payday in 7 days · 1 bill this week');
});

test('verdict: over today, or tight until payday', () => {
  const s = state();
  s.tx.push(tx('2026-10-13', 'expense', 900000));
  assert.equal(verdict(s, '2026-10-13').title, 'A bit over today');
  s.tx.push(tx('2026-10-12', 'expense', 2000000, { category: 'home', note: 'rent' }));
  assert.match(verdict(s, '2026-10-13').title, /^Tight until 20 Oct/);
});

test('steps: the bill due tomorrow and the savings still to move; "Later" hides one until tomorrow', () => {
  const s = state();
  const steps = nextSteps(s, '2026-10-13');
  assert.deepEqual(steps.map((x) => x.id), ['bill:net:2026-10-14', 'save:2026-10']);
  assert.equal(steps[0].act, 'rec-log');
  assert.deepEqual(steps[0].data, { id: 'net', date: '2026-10-14' });
  assert.equal(steps[1].act, 'step-save');
  assert.equal(steps[1].data.amount, 1400000); // 70% of 20 000
  assert.deepEqual(nextSteps(s, '2026-10-13', { hidden: { 'bill:net:2026-10-14': '2026-10-13' } }).map((x) => x.id), ['save:2026-10']);
  // Hidden yesterday: back today.
  assert.equal(nextSteps(s, '2026-10-13', { hidden: { 'bill:net:2026-10-14': '2026-10-12' } }).length, 2);
});

test('steps: last month\'s recap in the first week, until you watch it', () => {
  const s = state();
  s.tx.push(tx('2026-11-02', 'expense', 1000));
  const ids = () => nextSteps(s, '2026-11-03', { max: 9 }).map((x) => x.id);
  assert.ok(ids().includes('recap:2026-10'));
  s.meta.recapSeen = { '2026-10': 1 };
  assert.ok(!ids().includes('recap:2026-10'));
});

test('steps: a nudge after three days with nothing logged, and never more than three', () => {
  const s = state();
  const steps = nextSteps(s, '2026-10-16', { max: 9 });
  assert.ok(steps.some((x) => x.id === 'log:2026-10-16' && /since Sunday/.test(x.title)));
  s.settings.pay = { on: true, buffer: 'wallet', to: 'card', amount: 100000, day: 1, auto: false };
  assert.ok(nextSteps(s, '2026-10-16').length <= 3);
  assert.equal(nextSteps(s, '2026-10-16')[0].id, 'pay:2026-10'); // the salary comes first
});
