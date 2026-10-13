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

test('people screen: sorting, filtering, and view toggling', async () => {
  const { ctx } = await import('../js/ctx.js');
  const PeopleScreen = await import('../js/screens/people.js');

  const s = defaultState();
  s.people = [{ id: 'p1', name: 'Haruto', group: 'Work' }, { id: 'p2', name: 'Mother', group: 'Family' }];
  s.tx.push(tx('a', 'expense', 17500, { loan: true })); // Haruto owes 175 MDL

  ctx.state = s;
  ctx.ui = {};
  ctx.render = () => {};
  ctx.money = (n) => `${n} MDL`;

  const html = PeopleScreen.view();
  assert.ok(html.includes('Open Loans & Debts Hub'));
  assert.ok(html.includes('Haruto'));
  assert.ok(html.includes('Mother'));

  // View toggle
  PeopleScreen.onClick('people-view', { dataset: { view: 'table' } });
  assert.equal(ctx.ui.peopleView, 'table');
  const tableHtml = PeopleScreen.view();
  assert.ok(tableHtml.includes('<table class="pp-table">'));

  // Sort change
  PeopleScreen.onChange({ dataset: { act: 'people-sort' }, value: 'name' });
  assert.equal(ctx.ui.peopleSort, 'name');

  // Group toggle collapse
  PeopleScreen.onClick('people-toggle-group', { dataset: { group: 'Family' } });
  assert.ok(ctx.ui.peopleCollapsed.has('Family'));
});

test('people avatars: support custom emojis, photos, color rings, and auto-suggestion', async () => {
  const { personAvatar, colorOf, suggestEmoji } = await import('../js/screens/people.js');

  // Initial fallback
  const pDefault = { id: 'p1', name: 'Mother' };
  const htmlDefault = personAvatar(pDefault);
  assert.match(htmlDefault, /class="pp-av"/);
  assert.match(htmlDefault, />M<\/span>/);

  // Custom emoji
  const pEmoji = { id: 'p2', name: 'Mother', emoji: '👩' };
  const htmlEmoji = personAvatar(pEmoji);
  assert.match(htmlEmoji, /class="pp-av\s+emoji"/);
  assert.match(htmlEmoji, />👩<\/span>/);

  // Custom photo / image
  const pImg = { id: 'p3', name: 'Haruto', image: 'data:image/jpeg;base64,mockdata' };
  const htmlImg = personAvatar(pImg);
  assert.match(htmlImg, /class="pp-av\s+has-img"/);
  assert.match(htmlImg, /<img src="data:image\/jpeg;base64,mockdata" alt="Haruto" class="pp-av-img"/);

  // Custom color
  const pColor = { id: 'p4', name: 'Brother', color: 'var(--c7)' };
  assert.equal(colorOf(pColor), 'var(--c7)');
  const htmlColor = personAvatar(pColor);
  assert.match(htmlColor, /style="--pc:var\(--c7\)"/);

  // Auto-suggestion from name
  assert.equal(suggestEmoji('Mother'), '👩');
  assert.equal(suggestEmoji('Dad'), '👨');
  assert.equal(suggestEmoji('Grandpa'), '👴');
  assert.equal(suggestEmoji('Grandmother'), '👵');
  assert.equal(suggestEmoji('Brother'), '👦');
  assert.equal(suggestEmoji('Haruto'), '🥋');
  assert.equal(suggestEmoji('Client Acme'), '💼');
});

test('open loan card: delete button prompts in-place confirmation and removes loan transactions', async () => {
  const { ctx } = await import('../js/ctx.js');
  const PeopleScreen = await import('../js/screens/people.js');

  const s = defaultState();
  s.people = [{ id: 'p1', name: 'Haruto', group: 'Work' }];
  s.tx.push({
    id: 'tx-loan-1',
    createdAt: 1000,
    updatedAt: 1000,
    type: 'expense',
    amount: 17300,
    currency: 'MDL',
    rate: 1,
    base: 17300,
    date: '2026-10-12',
    category: 'other',
    account: 'acc-1',
    note: 'loan',
    person: 'p1',
    loan: true,
  });

  ctx.state = s;
  ctx.ui = {};
  let rendered = false;
  ctx.render = () => { rendered = true; };
  let committed = false;
  ctx.commit = () => { committed = true; };
  let toastMsg = '';
  let toastAction = null;
  ctx.toast = (msg, label, action) => {
    toastMsg = msg;
    toastAction = action;
  };
  ctx.money = (n) => `${n} MDL`;

  // 1. Initial view has Delete button
  const html1 = PeopleScreen.view();
  assert.match(html1, /data-act="loan-del-ask"/);
  assert.match(html1, /Delete/);

  // 2. Ask delete -> triggers confirmation
  PeopleScreen.onClick('loan-del-ask', { dataset: { id: 'p1', cur: 'MDL' } });
  assert.equal(ctx.ui.confirmingLoanDel, 'p1:MDL');
  const htmlConfirm = PeopleScreen.view();
  assert.match(htmlConfirm, /Delete this loan of/);
  assert.match(htmlConfirm, /data-act="loan-del-cancel"/);
  assert.match(htmlConfirm, /data-act="loan-del-do"/);

  // 3. Cancel confirmation
  PeopleScreen.onClick('loan-del-cancel', {});
  assert.equal(ctx.ui.confirmingLoanDel, undefined);

  // 4. Confirm delete
  PeopleScreen.onClick('loan-del-do', { dataset: { id: 'p1', cur: 'MDL', amt: '17300' } });
  assert.equal(s.tx.length, 0, 'loan tx removed');
  assert.ok(s.deleted['tx-loan-1'], 'marked in s.deleted');
  assert.ok(committed, 'commit was called');
  assert.match(toastMsg, /Deleted loan:/);
  assert.equal(typeof toastAction, 'function', 'undo callback supplied');
});

test('mergePeople reassigns transactions, removes source person, and marks sync deletion', async () => {
  const { mergePeople, defaultState } = await import('../js/model.js');
  const s = defaultState();
  s.people = [
    { id: 'p-brother', name: 'Brother', updatedAt: 100 },
    { id: 'p-oliviu', name: 'Oliviu', updatedAt: 100 },
  ];
  s.tx = [
    { id: 'tx-1', type: 'income', amount: 465000, date: '2026-08-02', person: 'p-brother', category: 'other-in', account: 'wallet' },
    { id: 'tx-2', type: 'income', amount: 40000, date: '2026-01-16', person: 'p-oliviu', category: 'other-in', account: 'wallet' },
  ];

  const res = mergePeople(s, 'p-oliviu', 'p-brother', 2000);
  assert.equal(res.count, 1);
  assert.equal(s.people.length, 1);
  assert.equal(s.people[0].id, 'p-brother');
  assert.equal(s.deleted['p-oliviu'], 2000);
  assert.equal(s.tx[1].person, 'p-brother');
  assert.equal(s.tx[1].updatedAt, 2000);
});

test('normalizeState automatically merges Oliviu into Brother if both exist', async () => {
  const { normalizeState } = await import('../js/model.js');
  const raw = {
    settings: {},
    people: [
      { id: 'p-brother', name: 'Brother', group: 'Family' },
      { id: 'p-oliviu', name: 'Oliviu', group: 'Other' },
    ],
    tx: [
      { id: 't1', type: 'income', amount: 465000, date: '2026-08-02', person: 'p-brother', category: 'other-in', account: 'wallet' },
      { id: 't2', type: 'income', amount: 40000, date: '2026-01-16', person: 'p-oliviu', category: 'other-in', account: 'wallet' },
    ],
  };

  const s = normalizeState(raw);
  assert.equal(s.people.length, 1, 'only Brother remains');
  assert.equal(s.people[0].name, 'Brother');
  assert.equal(s.people[0].id, 'p-brother');
  assert.ok(s.deleted['p-oliviu'], 'oliviu marked in deleted');
  assert.equal(s.tx[0].person, 'p-brother');
  assert.equal(s.tx[1].person, 'p-brother', 't2 moved to brother');
});

