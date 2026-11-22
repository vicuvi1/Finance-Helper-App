// Subscriptions table (js/subtable.js). All data made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/model.js';
import { ensureTree, subsOf } from '../js/cattree.js';
import { addSubscription, editSubscription, subscriptionTable, subscriptionNotices, subsCategory, isSubscription } from '../js/subtable.js';
import { makeTx } from '../js/recurring.js';

const TODAY = '2026-11-20';
function base() {
  const s = normalizeState({ tx: [] });
  ensureTree(s.settings);
  s.rates = { ...(s.rates || {}), usd: { MDL: 18, EUR: 0.9, USD: 1 } };
  s.tx.push({ id: 'in1', type: 'income', amount: 50000, currency: 'MDL', account: s.settings.accounts[0].id, category: 'other-in', date: '2026-11-01', note: 'made-up pay', createdAt: 1, updatedAt: 1 });
  return s;
}

test('add subscriptions in MDL, USD and EUR; totals in MDL; soonest first', () => {
  const s = base();
  const acc = s.settings.accounts[0].id;
  addSubscription(s, { name: 'Made-up AI', amount: 2000, currency: 'USD', next: '2026-11-22', account: acc }, { id: 'r1', today: TODAY });
  addSubscription(s, { name: 'Made-up Music', amount: 500, currency: 'EUR', next: '2026-12-10', account: acc }, { id: 'r2', today: TODAY });
  addSubscription(s, { name: 'Made-up Cloud', amount: 1200, currency: 'MDL', every: 'year', next: '2027-03-01', account: acc }, { id: 'r3', today: TODAY });
  const t = subscriptionTable(s, TODAY);
  assert.deepEqual(t.rows.map((r) => r.name), ['Made-up AI', 'Made-up Music', 'Made-up Cloud']);
  assert.equal(t.rows[0].status, 'soon', 'in 2 days with 3 warning days');
  assert.equal(t.rows[0].days, 2);
  assert.equal(t.rows[1].status, 'ok');
  // 20 USD = 360 MDL, 5 EUR = 100 MDL, 12 MDL a year = 1 MDL a month
  assert.equal(t.month, 36000 + 10000 + 100);
  assert.equal(t.year, t.month * 12);
  assert.ok(subsCategory(s), 'it goes in the Subscriptions category');
  assert.equal(s.recurring[0].category, subsCategory(s).id);
});

test('edit a cell: amount, currency, account, next date, type, warning days; paused goes last', () => {
  const s = base();
  addSubscription(s, { name: 'Made-up Video', amount: 15000, next: '2026-12-01' }, { id: 'r1', today: TODAY });
  assert.equal(editSubscription(s, 'r1', 'amount', 19900, { now: 5 }), true);
  assert.equal(s.recurring[0].amount, 19900);
  assert.equal(s.recurring[0].updatedAt, 5, 'edits sync (newest edit wins)');
  assert.equal(editSubscription(s, 'r1', 'amount', 19900), false, 'same value: no change');
  editSubscription(s, 'r1', 'currency', 'USD');
  editSubscription(s, 'r1', 'next', '2026-11-21');
  editSubscription(s, 'r1', 'remind', '1');
  assert.equal(subscriptionTable(s, TODAY).rows[0].status, 'soon');
  editSubscription(s, 'r1', 'remind', '0');
  assert.equal(subscriptionTable(s, TODAY).rows[0].status, 'ok', 'no warning days: just listed');
  const type = subsOf(s, subsCategory(s).id)[0];
  editSubscription(s, 'r1', 'sub', type.id);
  assert.equal(s.recurring[0].sub, type.id);
  assert.equal(makeTx(s.recurring[0], '2026-11-21', { id: 'x' }).sub, type.id, 'the record it makes keeps the type');
  editSubscription(s, 'r1', 'paused', true);
  assert.equal(subscriptionTable(s, TODAY).rows[0].status, 'paused');
  assert.equal(subscriptionTable(s, TODAY).count, 0);
});

test('late, today, and an account without enough money', () => {
  const s = base();
  s.settings.accounts.push({ id: 'card2', name: 'Made-up card', currency: 'MDL', kind: 'card' });
  addSubscription(s, { name: 'Made-up Late', amount: 1000, next: '2026-11-18', account: s.settings.accounts[0].id }, { id: 'r1', today: TODAY });
  addSubscription(s, { name: 'Made-up Today', amount: 9900, next: TODAY, account: 'card2' }, { id: 'r2', today: TODAY });
  const t = subscriptionTable(s, TODAY);
  assert.equal(t.rows[0].status, 'late');
  assert.equal(t.rows[1].status, 'today');
  assert.equal(t.rows[1].low, true, 'the card holds 0');
  const n = subscriptionNotices(s, TODAY);
  assert.equal(n.length, 2);
  assert.match(n[0].body, /Not logged yet/);
  assert.match(n[1].body, /due today from Made-up card/);
  assert.match(n[1].body, /top it up/);
  assert.doesNotMatch(subscriptionNotices(s, TODAY, { hidden: true })[1].title, /\d/, 'no amounts while amounts are hidden');
});

test('only subscriptions: other repeating payments stay out unless marked', () => {
  const s = base();
  s.recurring = [{ id: 'rent', type: 'expense', every: 'month', amount: 400000, currency: 'MDL', category: 'home', start: '2026-12-01', note: 'made-up rent' }];
  assert.equal(isSubscription(s, s.recurring[0]), false);
  assert.equal(subscriptionTable(s, TODAY).rows.length, 0);
  s.recurring[0].subscription = true;
  assert.equal(subscriptionTable(s, TODAY).rows.length, 1);
});

test('notifications: a subscription due soon is sent once per payment date', async () => {
  const { dueNotices } = await import('../js/notifier.js');
  const s = base();
  addSubscription(s, { name: 'Made-up Notes', amount: 5000, next: '2026-11-22', account: s.settings.accounts[0].id }, { id: 'r1', today: TODAY });
  const subs = (r) => r.notices.filter((n) => n.key.startsWith('sub:'));
  const first = dueNotices(s, TODAY, {});
  assert.equal(subs(first).length, 1);
  assert.match(subs(first)[0].title, /Made-up Notes/);
  assert.match(subs(first)[0].body, /in 2 days/);
  assert.equal(subs(dueNotices(s, TODAY, first.sent)).length, 0, 'not twice');
  assert.equal(subs(dueNotices(s, '2026-11-22', first.sent)).length, 1, 'once more on the day');
});

test('"Next payment" on a rule set to a day of the month moves to the day you picked', () => {
  const s = normalizeState({ recurring: [{ id: 'dom5', type: 'expense', subscription: true, note: 'Made-up Cloud', amount: 9900, currency: 'MDL', every: 'custom', n: 1, unit: 'month', dom: 5, start: '2026-01-05', lastDone: '2026-11-05' }] });
  assert.equal(subscriptionTable(s, TODAY).rows[0].next, '2026-12-05');
  assert.equal(editSubscription(s, 'dom5', 'next', '2026-12-20'), true);
  assert.equal(subscriptionTable(s, TODAY).rows[0].next, '2026-12-20', 'not the 5th of January');
  assert.equal(subscriptionTable(s, '2027-01-25').rows[0].next, '2026-12-20', 'late until it is logged');
});
