import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reactToTx, greeting } from '../js/buddy.js';
import { defaultState, category } from '../js/model.js';

let n = 0;
const tx = (date, type, amount, cat = 'food', extra = {}) => ({ id: `b${n++}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: cat, account: 'wallet', note: 'x', ...extra });
const first = () => 0;

function state() {
  const s = defaultState();
  for (let d = 1; d <= 30; d++) s.tx.push(tx(`2026-09-${String(d).padStart(2, '0')}`, 'expense', 10000)); // 100 lei a day
  return s;
}

test('cheers a normal record, warns on budgets and big ones', () => {
  const s = state();
  const t1 = tx('2026-10-10', 'expense', 5000);
  s.tx.push(t1);
  assert.deepEqual(reactToTx(s, t1, '2026-10-10', first), { mood: 'happy', text: 'Logged! Keep it up 💪' });
  const big = tx('2026-10-10', 'expense', 90000, 'clothes');
  s.tx.push(big);
  assert.equal(reactToTx(s, big, '2026-10-10', first).mood, 'surprised');
  category(s, 'fun').budget = 10000;
  const fun = tx('2026-10-10', 'expense', 12000, 'fun');
  s.tx.push(fun);
  const r = reactToTx(s, fun, '2026-10-10', first);
  assert.equal(r.mood, 'worried');
  assert.match(r.text, /over budget.*careful/);
});

test('income and savings get a celebration', () => {
  const s = state();
  const inc = tx('2026-10-10', 'income', 1000000, 'work');
  assert.match(reactToTx(s, inc, '2026-10-10', first).text, /Money in!.*70%.*7\s000/);
  const move = { ...tx('2026-10-10', 'transfer', 500000), from: 'card', to: 'safe' };
  assert.equal(reactToTx(s, move, '2026-10-10', first).mood, 'proud');
});

test('greets with how the month goes', () => {
  const s = defaultState();
  s.tx.push(tx('2026-10-02', 'income', 1000000, 'work'), tx('2026-10-03', 'expense', 100000));
  assert.match(greeting(s, '2026-10-10', 10, first).text, /keeping 90%.*Above your 70%/);
  assert.equal(greeting(s, '2026-10-10', 23, first).mood, 'sleepy');
});
