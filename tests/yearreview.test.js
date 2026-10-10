import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearReview, taxSummary } from '../js/yearreview.js';
import { defaultState } from '../js/model.js';

let n = 0;
const tx = (date, type, amount, category, extra = {}) => ({ id: `y${n++}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category, account: 'wallet', note: 'x', ...extra });

function sample() {
  const s = defaultState();
  s.people = [{ id: 'p1', name: 'Acme Inc', client: true }];
  s.tx.push(
    tx('2025-06-01', 'income', 500000, 'work'),
    tx('2026-01-05', 'income', 1000000, 'work'),
    tx('2026-01-06', 'expense', 200000, 'food'),
    tx('2026-01-07', 'expense', 50000, 'transport'),
    tx('2026-02-10', 'income', 100000, 'side', { currency: 'USD', rate: 17.5, base: 1750000, person: 'p1' }),
    tx('2026-02-11', 'expense', 900000, 'food'),
    tx('2026-03-01', 'income', 30000, 'family', { loan: true, person: 'p1' }),
  );
  return s;
}

test('year in review highlights', () => {
  const r = yearReview(sample(), 2026, '2026-10-10');
  assert.equal(r.income, 2750000);
  assert.equal(r.expense, 1150000);
  assert.equal(r.partial, true);
  assert.equal(r.best.key, '2026-02');
  assert.equal(r.priciest.key, '2026-02');
  assert.equal(r.topCategories[0].name, 'Food');
  assert.equal(r.topClient.name, 'Acme Inc');
  assert.equal(r.streak, 3);
  assert.equal(r.vs.income, 500000);
  assert.equal(r.biggest.amount, 900000);
});

test('tax summary: incomes only, no loans, by currency and source', () => {
  const t = taxSummary(sample(), 2026);
  assert.equal(t.rows.length, 2);
  assert.equal(t.total, 2750000);
  assert.deepEqual(t.byCurrency.map((x) => [x.name, x.amount, x.base]), [['USD', 100000, 1750000], ['MDL', 1000000, 1000000]]);
  assert.equal(t.rows[1].payer, 'Acme Inc');
  assert.equal(t.rows[1].rate, 17.5);
  assert.equal(t.byMonth[1].base, 1750000);
});
