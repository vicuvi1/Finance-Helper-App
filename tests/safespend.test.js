import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeToSpend, safeLine } from '../js/safespend.js';
import { defaultState } from '../js/model.js';
import { formatMoney } from '../js/money.js';

const tx = (date, type, amount, extra = {}) => ({ id: `${date}-${type}-${amount}-${Math.random()}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'work' : 'food', account: 'card', note: '', ...extra });

// Made-up numbers: 20 000 earned on the 1st, 10 000 on the card already.
function state() {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'card').start = 1000000;
  s.settings.accounts.find((a) => a.id === 'safe').start = 5000000; // savings: never spending money
  s.tx.push(tx('2026-10-01', 'income', 2000000));
  s.recurring = [
    { id: 'net', type: 'expense', amount: 15000, currency: 'MDL', account: 'card', category: 'home', note: 'internet', every: 'month', start: '2026-09-14', lastDone: '2026-09-14' },
    { id: 'pay', type: 'income', amount: 2000000, currency: 'MDL', account: 'card', category: 'work', note: 'retainer', every: 'month', start: '2026-09-20', lastDone: '2026-10-01' },
  ];
  return s;
}

test('cards and cash, minus bills before payday and the savings plan, over the days left', () => {
  const s = state();
  // 70% of 20 000 = 14 000 to save; 4 000 of it already moved to the safe.
  s.tx.push(tx('2026-10-02', 'transfer', 400000, { from: 'card', to: 'safe' }));
  const r = safeToSpend(s, '2026-10-12');
  assert.equal(r.liquid, 1000000 + 2000000 - 400000); // 26 000 on the card
  assert.equal(r.payday, '2026-10-20');
  assert.equal(r.paydayFrom, 'retainer');
  assert.equal(r.days, 8);
  assert.deepEqual(r.bills.map((b) => b.label), ['internet']); // due 14 Oct
  assert.equal(r.savingsLeft, 1000000);
  // (26 000 - 150 - 10 000) / 8 = 1 981,25 → 1 981 a day.
  assert.equal(r.perDay, 198100);
  assert.equal(r.leftToday, 198100);
});

test("today's spending comes out of today's share; over it, tomorrow's share drops", () => {
  const s = state();
  s.tx.push(tx('2026-10-12', 'expense', 50000));
  let r = safeToSpend(s, '2026-10-12');
  const perDay = r.perDay;
  assert.equal(r.spentToday, 50000);
  assert.equal(r.leftToday, perDay - 50000); // the daily share stays the same during the day
  s.tx.push(tx('2026-10-12', 'expense', 300000));
  r = safeToSpend(s, '2026-10-12');
  assert.ok(r.leftToday < 0);
  assert.ok(r.tomorrow < perDay);
  const fmt = (c) => formatMoney(c, 'MDL');
  assert.match(safeLine(s, '2026-10-12', fmt), /over today's/);
});

test('no recurring income: until the end of the month; nothing safe when bills and savings eat it all', () => {
  const s = state();
  s.recurring = s.recurring.filter((x) => x.type !== 'income');
  let r = safeToSpend(s, '2026-10-12');
  assert.equal(r.payday, '2026-11-01');
  assert.equal(r.days, 20);
  assert.equal(r.paydayFrom, null);
  s.tx.push(tx('2026-10-05', 'expense', 1700000)); // a big purchase
  r = safeToSpend(s, '2026-10-12');
  assert.equal(r.perDay, 0);
  assert.ok(r.short > 0);
  assert.match(safeLine(s, '2026-10-12', (c) => formatMoney(c, 'MDL')), /Nothing safe to spend/);
});

test('the bot adds it to expense replies and /today', async () => {
  const { loggedText, todayText } = await import('../js/telegram.js');
  const s = state();
  const t = tx('2026-10-12', 'expense', 3500, { note: 'coffee' });
  s.tx.push(t);
  assert.match(loggedText(s, t, '2026-10-12'), /Safe to spend today: <b>[\d\s ]+MDL<\/b> left/);
  assert.doesNotMatch(loggedText(s, t), /Safe to spend/); // without today (old callers): unchanged
  assert.match(todayText(s, '2026-10-12'), /Safe to spend today/);
});
