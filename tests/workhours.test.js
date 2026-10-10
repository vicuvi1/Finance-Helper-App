import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourlyRate, formatWork, workText } from '../js/workhours.js';
import { defaultState } from '../js/model.js';

const inc = (id, date, amount) => ({ id, type: 'income', amount, currency: 'MDL', rate: 1, base: amount, date, category: 'work', account: 'wallet', note: 'x' });

test('from income: last 3 full months over 160 h', () => {
  const s = defaultState();
  s.tx.push(inc('a', '2026-07-05', 1600000), inc('b', '2026-08-05', 1600000), inc('c', '2026-09-05', 1600000), inc('d', '2026-10-05', 9900000));
  assert.deepEqual(hourlyRate(s, '2026-10-10'), { rate: 10000, source: 'income' });
  assert.equal(workText(s, 35000, '2026-10-10'), '3,5 h');
  s.settings.workHour = { hoursPerMonth: 80 };
  assert.equal(hourlyRate(s, '2026-10-10').rate, 20000);
  s.settings.workHour = { show: false };
  assert.equal(workText(s, 35000, '2026-10-10'), '');
});

test('from paid invoices with hours, or set by hand', () => {
  const s = defaultState();
  s.tx.push(inc('p1', '2026-09-20', 1200000));
  s.invoices = [{ id: 'i1', paidDate: '2026-09-20', paidTx: 'p1', items: [{ hours: 20, rate: 3000 }] }];
  assert.deepEqual(hourlyRate(s, '2026-10-10'), { rate: 60000, source: 'invoices', hours: 20 });
  s.settings.workHour = { mode: 'manual', rate: 25000 };
  assert.deepEqual(hourlyRate(s, '2026-10-10'), { rate: 25000, source: 'manual' });
  assert.equal(hourlyRate(defaultState(), '2026-10-10'), null);
});

test('format', () => {
  assert.equal(formatWork(0.2), '12 min');
  assert.equal(formatWork(3.46), '3,5 h');
  assert.equal(formatWork(12), '1,5 work days');
  assert.equal(formatWork(8), '1 work day');
  assert.equal(formatWork(400), '10 work weeks');
});
