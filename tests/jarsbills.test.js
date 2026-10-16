// Jars use your usual income while the month's pay hasn't arrived, bills
// don't eat today's safe-to-spend, and work costs leave the personal jars.
// Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, jarStatus, expectedIncome, isBillCategory, moveWorkCostsOutOfJars, NO_JAR } from '../js/model.js';
import { safeToSpend } from '../js/safespend.js';

const tx = (date, type, amount, extra = {}) => ({ id: `${date}-${type}-${amount}-${Math.random()}`, type, amount, currency: 'MDL', rate: 1, base: amount, date, category: type === 'income' ? 'work' : 'food', account: 'card', note: '', ...extra });

function state() {
  const s = defaultState();
  s.settings.accounts.find((a) => a.id === 'card').start = 3000000;
  // Usual months: 20 000 earned.
  for (const m of ['07', '08', '09']) s.tx.push(tx(`2026-${m}-05`, 'income', 2000000));
  // This month so far: only 2 000 in, 1 500 spent on food.
  s.tx.push(tx('2026-10-04', 'income', 200000));
  s.tx.push(tx('2026-10-10', 'expense', 150000));
  return s;
}

test('usual income: the larger of the regular incomes and the last 3 months', () => {
  const s = state();
  assert.equal(expectedIncome(s, '2026-10'), 2000000);
  s.recurring = [{ id: 'r', type: 'income', amount: 3000000, currency: 'MDL', every: 'month', start: '2026-01-20' }];
  assert.equal(expectedIncome(s, '2026-10'), 3000000);
});

test('jars this month use the usual income until the pay arrives; past months and old callers use what came in', () => {
  const s = state();
  const living = (rows) => rows.find((j) => j.jar.id === 'living');
  const now = living(jarStatus(s, '2026-10', '2026-10-16'));
  assert.equal(now.budget, 200000); // 10% of the usual 20 000, not of 2 000
  assert.equal(now.estimated, true);
  assert.ok(now.used > 0 && now.used < now.budget); // 1 500 of a 2 000 food jar isn't "over"
  const old = living(jarStatus(s, '2026-10'));
  assert.equal(old.budget, 20000); // without today: as before
  // A big month: the real income wins.
  s.tx.push(tx('2026-10-15', 'income', 5000000));
  const big = living(jarStatus(s, '2026-10', '2026-10-16'));
  assert.equal(big.budget, 520000);
  assert.equal(big.estimated, false);
});

test('bills: Home & bills and rent-like names are bills; your own choice wins', () => {
  const s = defaultState();
  assert.equal(isBillCategory(s, 'home'), true);
  assert.equal(isBillCategory(s, 'subscriptions'), true);
  assert.equal(isBillCategory(s, 'food'), false);
  s.settings.categories.push({ id: 'rent2', name: 'Chirie', type: 'expense', jar: 'living' });
  assert.equal(isBillCategory(s, 'rent2'), true);
  s.settings.categories.find((c) => c.id === 'home').bill = false;
  assert.equal(isBillCategory(s, 'home'), false);
});

test("safe to spend: paying the rent today doesn't use up today's share", () => {
  const s = state();
  const before = safeToSpend(s, '2026-10-16');
  s.tx.push(tx('2026-10-16', 'expense', 400000, { category: 'home', note: 'Apartament' }));
  const after = safeToSpend(s, '2026-10-16');
  assert.equal(after.spentToday, 0);
  assert.equal(after.leftToday, after.perDay); // the whole daily share is still there
  assert.ok(after.perDay < before.perDay); // the rent made every day's share a bit smaller
  s.tx.push(tx('2026-10-16', 'expense', 5000)); // a coffee does count
  assert.equal(safeToSpend(s, '2026-10-16').spentToday, 5000);
});

test('work costs leave the personal jars once; Coffee stays; a choice you made stays', () => {
  const s = defaultState();
  s.settings.categories.push(
    { id: 'wf', name: 'Work fees', type: 'expense', jar: 'growth' },
    { id: 'cof', name: 'Coffee', type: 'expense', jar: 'living' },
    { id: 'tx', name: 'Taxes', type: 'expense', jar: 'living', jarChosen: true },
  );
  assert.deepEqual(moveWorkCostsOutOfJars(s, 1), ['Work fees']);
  const c = (id) => s.settings.categories.find((x) => x.id === id);
  assert.equal(c('wf').jar, NO_JAR);
  assert.equal(c('wf').updatedAt, 1);
  assert.equal(c('cof').jar, 'living');
  assert.equal(c('tx').jar, 'living');
});
