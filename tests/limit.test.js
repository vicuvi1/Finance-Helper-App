// A monthly spending limit: today's share is the smaller of what the limit
// and what your money allow. Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeToSpend, safeLine, limitStatus, suggestLimit, isEveryday } from '../js/safespend.js';
import { defaultState, NO_JAR } from '../js/model.js';
import { formatMoney } from '../js/money.js';

const tx = (date, type, amount, extra = {}) => ({ id: `${date}-${type}-${amount}-${Math.random()}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'work' : 'food', account: 'card', note: '', ...extra });
const fmt = (c) => formatMoney(c, 'MDL');

function state() {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'card').start = 1000000;
  s.tx.push(tx('2026-10-01', 'income', 2000000));
  s.tx.push(tx('2026-10-05', 'expense', 800000)); // groceries etc.
  s.recurring = [
    { id: 'net', type: 'expense', amount: 15000, currency: 'MDL', account: 'card', category: 'home', note: 'internet', every: 'month', start: '2026-09-14', lastDone: '2026-09-14' },
    { id: 'pay', type: 'income', amount: 2000000, currency: 'MDL', account: 'card', category: 'work', note: 'retainer', every: 'month', start: '2026-09-20', lastDone: '2026-10-01' },
  ];
  return s;
}

test('no limit: nothing changes', () => {
  const r = safeToSpend(state(), '2026-10-12');
  assert.equal(r.limit, null);
  assert.equal(r.byLimit, false);
  assert.equal(r.perDay, r.moneyPerDay);
});

test('a 20 000 limit: what is left of it over the days left in the month', () => {
  const s = state();
  s.settings.limit = { on: true, amount: 2000000 };
  s.tx.push(tx('2026-10-12', 'expense', 20000)); // 200 today
  const r = safeToSpend(s, '2026-10-12');
  // Limit: 20 000 − 8 000 before today = 12 000 over 20 days (12th–31st) = 600 a day.
  assert.equal(r.limit.perDay, 60000);
  assert.equal(r.limit.daysLeft, 20);
  assert.equal(r.limit.spent, 820000);
  assert.equal(r.limit.left, 1180000);
  // Money alone would allow 981 a day, so the limit decides.
  assert.equal(r.moneyPerDay, 98100);
  assert.equal(r.byLimit, true);
  assert.equal(r.perDay, 60000);
  assert.equal(r.leftToday, 40000);
  // From tomorrow: 11 800 over 19 days = 621 (money would give 1 092).
  assert.equal(r.tomorrow, 62100);
});

test('bills, repeating payments and work costs are not everyday spending', () => {
  const s = state();
  s.settings.categories.push({ id: 'fees', name: 'Work fees', type: 'expense', jar: NO_JAR });
  s.settings.limit = { on: true, amount: 2000000 };
  const rent = tx('2026-10-03', 'expense', 500000, { category: 'home', note: 'rent' });
  const fee = tx('2026-10-04', 'expense', 300000, { category: 'fees' });
  s.tx.push(rent, fee);
  assert.equal(isEveryday(s, rent), false);
  assert.equal(isEveryday(s, fee), false);
  assert.equal(limitStatus(s, '2026-10-12').spent, 800000);
});

test('limit used up: nothing left today, and the bot says so', () => {
  const s = state();
  s.settings.limit = { on: true, amount: 800000 };
  const r = safeToSpend(s, '2026-10-12');
  assert.equal(r.perDay, 0);
  assert.equal(r.leftToday, 0);
  assert.match(safeLine(s, '2026-10-12', fmt), /limit for the month is used up/);
});

test('a limit higher than your money: your money decides', () => {
  const s = state();
  s.settings.limit = { on: true, amount: 10000000 };
  const r = safeToSpend(s, '2026-10-12');
  assert.equal(r.byLimit, false);
  assert.equal(r.perDay, r.moneyPerDay);
});

test('suggested limit: your usual everyday spending, in whole hundreds', () => {
  const s = state();
  s.tx.push(tx('2026-07-10', 'expense', 600000), tx('2026-09-10', 'expense', 700000));
  s.tx.push(tx('2026-09-11', 'expense', 900000, { category: 'home' })); // rent: not counted
  assert.equal(suggestLimit(s, '2026-10-12'), 650000);
  assert.equal(suggestLimit(defaultState(), '2026-10-12'), 0);
});

test('pace: where the month is heading, in whole lei', () => {
  const s = state();
  s.settings.limit = { on: true, amount: 1000000 };
  s.tx.push(tx('2026-10-07', 'expense', 33333));
  // 8 333,33 spent by the 12th → about 21 528 by the 31st.
  assert.equal(limitStatus(s, '2026-10-12').projected, 2152800);
});
