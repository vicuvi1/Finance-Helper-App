// The month recap: numbers for the story and the bot. Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthRecap, recapText, recapMonths } from '../js/recap.js';
import { defaultState, NO_JAR } from '../js/model.js';

const tx = (date, type, amount, extra = {}) => ({ id: `${date}-${type}-${amount}-${Math.random()}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'family' : 'food', account: 'card', note: '', ...extra });

function state() {
  const s = defaultState();
  s.settings.categories.push({ id: 'fees', name: 'Work fees', type: 'expense', jar: NO_JAR });
  // September: 1 000 on food.
  s.tx.push(tx('2026-09-05', 'expense', 100000));
  // October: 10 000 in; food 1 500 over three days, rent 3 000, a work fee (not yours) 500.
  s.tx.push(tx('2026-10-01', 'income', 1000000));
  s.tx.push(tx('2026-10-02', 'expense', 50000, { note: 'groceries' }));
  s.tx.push(tx('2026-10-09', 'expense', 70000, { note: 'big shop' }));
  s.tx.push(tx('2026-10-16', 'expense', 30000));
  s.tx.push(tx('2026-10-03', 'expense', 300000, { category: 'home', note: 'rent' }));
  s.tx.push(tx('2026-10-04', 'expense', 50000, { category: 'fees' }));
  s.tx.push(tx('2026-10-20', 'transfer', 200000, { from: 'card', to: 'safe' }));
  return s;
}

test('a month in numbers: in, spent (work costs apart), kept, where it went', () => {
  const r = monthRecap(state(), '2026-10');
  assert.equal(r.name, 'October');
  assert.equal(r.income, 950000); // what came in for you: the work fee comes off it (personalMonth)
  assert.equal(r.spent, 450000); // food 1 500 + rent 3 000
  assert.deepEqual(r.top.map((c) => [c.id, c.amount]), [['home', 300000], ['food', 150000]]);
  assert.equal(Math.round(r.top[0].share * 100), 67);
  assert.equal(r.toSavings, 200000);
  assert.equal(r.biggest.note, 'rent');
});

test('highlights: no-spend days, the rise against last month, and a tip', () => {
  const r = monthRecap(state(), '2026-10');
  assert.equal(r.noSpend, 28); // everyday spending on 3 of 31 days (rent is a bill)
  assert.equal(r.up.id, 'food');
  assert.equal(r.up.diff, 50000);
  assert.match(r.tip.text, /Food & dining grew|grew by/);
});

test('with a limit: over it, the tip says so', () => {
  const s = state();
  s.settings.limit = { on: true, amount: 100000 };
  const r = monthRecap(s, '2026-10');
  assert.equal(r.everyday, 150000);
  assert.equal(r.tip.act, 'limit-setup');
  assert.match(r.tip.text, /over your limit/);
});

test('the bot\'s recap and the months you can look back on', () => {
  const s = state();
  const text = recapText(s, '2026-10');
  assert.match(text, /Your October 2026/);
  assert.match(text, /Where it went/);
  assert.match(text, /no-spend days/);
  assert.deepEqual(recapMonths(s, '2026-11-02'), ['2026-10', '2026-09']);
  assert.match(recapText(s, '2026-07'), /Nothing logged/);
});
