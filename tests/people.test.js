import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultState, peopleSummary, deletePerson, loanAmount } from '../js/model.js';

const tx = (id, type, amount, extra = {}) => ({ id, type, amount, currency: 'MDL', rate: 1, base: amount, date: '2026-10-01', category: 'other', account: 'wallet', note: '', person: 'p1', ...extra });

test('loans are owed in their own currency', () => {
  const s = defaultState();
  s.people = [{ id: 'p1', name: 'Haruto' }];
  s.tx.push(
    tx('a', 'expense', 175000, { loan: true, debt: { amount: 10000, currency: 'USD' } }), // lent 100 USD from an MDL card
    tx('b', 'expense', 17300, { loan: true }), // lent 173 MDL
    tx('c', 'income', 87500, { loan: true, debt: { amount: 5000, currency: 'USD' } }), // got 50 USD back
    tx('d', 'income', 30000), // a gift, not a loan
  );
  const [r] = peopleSummary(s);
  assert.deepEqual(r.owes, { USD: 5000, MDL: 17300 });
  assert.equal(r.received, 117500);
  assert.deepEqual(loanAmount(s.tx[1]), { amount: 17300, currency: 'MDL' });
  s.tx.push(tx('e', 'income', 17300, { loan: true }));
  assert.deepEqual(peopleSummary(s)[0].owes, { USD: 5000 }, 'settled currencies disappear');
});

test('deleting a person keeps the records with the name on them', () => {
  const s = defaultState();
  s.people = [{ id: 'p1', name: 'Haruto' }, { id: 'p2', name: 'Ana' }];
  s.tx.push(tx('a', 'income', 100));
  const p = deletePerson(s, 'p1', 99);
  assert.equal(p.name, 'Haruto');
  assert.deepEqual(s.people.map((x) => x.id), ['p2']);
  assert.equal(s.tx[0].person, undefined);
  assert.equal(s.tx[0].personName, 'Haruto');
  assert.equal(s.tx[0].updatedAt, 99);
  assert.equal(s.deleted.p1, 99);
});

test('debts you owe: negative owes indicates you owe them', () => {
  const s = defaultState();
  s.people = [{ id: 'p1', name: 'Bob' }];
  // I borrowed 200 MDL from Bob (income for me)
  s.tx.push(tx('b1', 'income', 20000, { loan: true, note: 'borrowed' }));
  const [r] = peopleSummary(s);
  assert.deepEqual(r.owes, { MDL: -20000 });
  // I paid back 200 MDL (expense for me)
  s.tx.push(tx('b2', 'expense', 20000, { loan: true, note: 'paid back' }));
  const [r2] = peopleSummary(s);
  assert.deepEqual(r2.owes, {});
});

test('navigation: people is primary tab over clients', () => {
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(indexHtml, /href="#people"[^>]*data-tab="people"[^>]*data-key="6"/);
  assert.match(indexHtml, /<span class="nl">People<\/span>/);

  const appJs = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appJs, /6:\s*'people'/);
  assert.match(appJs, /SUB_TABS\s*=\s*\[[\s\S]*?tab:\s*'people'[\s\S]*?tab:\s*'clients'/);
  assert.match(appJs, /NAV_PARENT\s*=\s*\{[^}]*clients:\s*'people'/);
});

