import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast, dailySpend } from '../js/forecast.js';
import { defaultState } from '../js/model.js';

const ex = (date, amount, extra = {}) => ({ id: `${date}-${amount}-${Math.random()}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date, category: 'food', account: 'card', note: '', ...extra });

function state() {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'card').start = 1000000; // 10 000 on the card
  s.settings.accounts.find((a) => a.id === 'safe').start = 5000000; // savings: not spending money
  // 30 days of 100 lei a day, plus a rent payment that recurring covers.
  for (let d = 1; d <= 30; d++) s.tx.push(ex(`2026-09-${String(d).padStart(2, '0')}`, 10000));
  s.tx.push(ex('2026-09-25', 450000, { recurring: 'rent' }));
  s.recurring = [
    { id: 'rent', type: 'expense', amount: 450000, currency: 'MDL', account: 'card', category: 'home', note: 'rent', every: 'month', start: '2026-09-25', lastDone: '2026-09-25' },
    { id: 'sal', type: 'income', amount: 1500000, currency: 'MDL', account: 'card', category: 'work', note: 'salary', every: 'month', start: '2026-09-05', lastDone: '2026-10-05' },
  ];
  return s;
}

test('daily spending leaves out recurring and loans', () => {
  assert.equal(dailySpend(state(), '2026-09-30'), 10000);
});

test('projects bills, income and daily spending; finds the low point', () => {
  const s = state();
  const f = forecast(s, '2026-09-30', { days: 40 });
  // Start: 10 000 card - 3 000 spent - 4 500 rent = 2 500 (the safe is not counted).
  assert.equal(f.start, 250000);
  // Rent on Oct 25 and spending go on until the salary on Nov 5: lowest on Nov 4.
  assert.equal(f.low.date, '2026-11-04');
  assert.equal(f.low.value, 250000 - 35 * 10000 - 450000);
  assert.equal(f.bills, 450000);
  assert.equal(f.income, 1500000);
  assert.equal(f.points.length, 41);
});

test('unpaid invoices count on their due date, overdue ones a week out', () => {
  const s = state();
  s.recurring = [];
  s.invoices = [
    { id: 'i1', number: 'INV-1', date: '2026-09-01', due: '2026-10-10', sent: true, currency: 'MDL', items: [{ amount: 100000 }] },
    { id: 'i2', number: 'INV-2', date: '2026-08-01', due: '2026-09-01', sent: true, currency: 'MDL', items: [{ amount: 50000 }] },
    { id: 'i3', number: 'INV-3', date: '2026-09-01', due: '2026-10-10', sent: false, currency: 'MDL', items: [{ amount: 999900 }] },
  ];
  const f = forecast(s, '2026-09-30', { days: 30 });
  assert.deepEqual(f.events.map((e) => [e.date, e.amount, e.late]), [['2026-10-07', 50000, true], ['2026-10-10', 100000, false]]);
});
