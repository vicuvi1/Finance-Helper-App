import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeState, defaultState, accountBalances, accountValues, totalBalance, monthSummary,
  peopleSummary, ensurePerson, ensureCategory, removeTx, restoreTx, goalStatus, SCHEMA_VERSION,
} from '../js/model.js';
import { convert, pairRate, coinValue, formatRate, formatQty } from '../js/fx.js';

// 1 USD = 17.5 MDL = 0.9 EUR; BTC at 60 000 USD.
const RATES = { usd: { MDL: 17.5, EUR: 0.9 }, crypto: { BTC: 60000 } };

test('fx converts through USD and leaves unknown pairs empty', () => {
  assert.equal(convert(10000, 'USD', 'MDL', RATES), 175000);
  assert.equal(convert(175000, 'MDL', 'USD', RATES), 10000);
  assert.equal(convert(9000, 'EUR', 'MDL', RATES), 175000);
  assert.equal(convert(100, 'MDL', 'MDL', null), 100);
  assert.equal(convert(100, 'USD', 'GBP', RATES), null);
  assert.equal(pairRate('USD', 'MDL', RATES), 17.5);
  assert.equal(coinValue(0.01, 'BTC', 'USD', RATES), 60000);
  assert.equal(coinValue(5, 'USDT', 'USD', RATES), 500);
  assert.equal(formatRate(17.5432), '17.54');
  assert.equal(formatQty(0.00012300), '0.000123');
});

test('v1 data migrates to v2 without losing anything', () => {
  const v1 = {
    version: 1,
    settings: { currency: 'MDL', accounts: [{ id: 'wallet', name: 'Wallet', emoji: '👛', start: 5000 }] },
    tx: [{ id: 'a', type: 'expense', amount: 1200, date: '2026-03-02', category: 'food', account: 'wallet', createdAt: 7 }],
  };
  const s = normalizeState(v1);
  assert.equal(s.version, SCHEMA_VERSION);
  const acc = s.settings.accounts[0];
  assert.equal(acc.currency, 'MDL');
  assert.equal(acc.kind, 'cash');
  assert.equal(acc.start, 5000);
  assert.deepEqual(acc.holdings, []);
  const t = s.tx[0];
  assert.equal(t.currency, 'MDL');
  assert.equal(t.base, 1200);
  assert.equal(t.updatedAt, 7);
  assert.deepEqual(s.people, []);
  assert.deepEqual(s.deleted, {});
});

function multi() {
  const s = defaultState();
  s.rates = RATES;
  s.settings.accounts.push(
    { id: 'usd', name: 'maib USD', bank: 'maib', kind: 'card', currency: 'USD', start: 0, holdings: [] },
    { id: 'bin', name: 'Binance', bank: 'Binance', kind: 'crypto', currency: 'USD', start: 0, holdings: [{ asset: 'BTC', qty: 0.01 }] },
  );
  return s;
}

test('foreign-currency income counts in MDL at the rate of the day', () => {
  const s = multi();
  s.tx.push({ id: 'i', type: 'income', amount: 100000, currency: 'USD', rate: 17.2, base: 1720000, date: '2026-10-02', account: 'usd', category: 'work' });
  const m = monthSummary(s, '2026-10');
  assert.equal(m.income, 1720000); // stored rate, not today's 17.5
  assert.equal(accountBalances(s).usd, 100000);
  const v = accountValues(s).find((x) => x.account.id === 'usd');
  assert.equal(v.inBase, 1750000); // balance uses today's rate
});

test('crypto holdings add to the total at live prices', () => {
  const s = multi();
  const { total, missing } = totalBalance(s);
  assert.equal(missing.length, 0);
  assert.equal(total, 60000 * 17.5); // 0.01 BTC = 600 USD = 10 500 MDL
  s.rates = { usd: { MDL: 17.5 } }; // no BTC price
  const v = accountValues(s).find((x) => x.account.id === 'bin');
  assert.equal(v.coinsKnown, false);
});

test('a transfer between currencies moves the right amount on each side', () => {
  const s = multi();
  s.tx.push({ id: 't', type: 'transfer', amount: 175000, toAmount: 10000, currency: 'MDL', base: 175000, date: '2026-10-03', from: 'wallet', to: 'usd' });
  const bal = accountBalances(s);
  assert.equal(bal.wallet, -175000);
  assert.equal(bal.usd, 10000);
});

test('without a rate an account is listed as missing, not counted as zero', () => {
  const s = multi();
  s.rates = null;
  s.tx.push({ id: 'i', type: 'income', amount: 5000, currency: 'USD', rate: 17, base: 85000, date: '2026-10-02', account: 'usd', category: 'work' });
  const { missing } = totalBalance(s);
  assert.ok(missing.some((v) => v.account.id === 'usd'));
});

test('people: who gave, who received, and open loans', () => {
  const s = defaultState();
  const ana = ensurePerson(s, 'Ana');
  assert.equal(ensurePerson(s, '  ana '), ana);
  const mom = ensurePerson(s, 'Mom');
  s.tx.push(
    { id: '1', type: 'income', amount: 50000, base: 50000, date: '2026-10-01', person: mom, account: 'wallet', category: 'family' },
    { id: '2', type: 'expense', amount: 30000, base: 30000, date: '2026-10-02', person: ana, loan: true, account: 'wallet', category: 'other' },
    { id: '3', type: 'income', amount: 10000, base: 10000, date: '2026-10-05', person: ana, loan: true, account: 'wallet', category: 'other-in' },
  );
  const rows = Object.fromEntries(peopleSummary(s).map((r) => [r.person.name, r]));
  assert.equal(rows.Mom.received, 50000);
  assert.equal(rows.Ana.given, 30000);
  assert.equal(rows.Ana.owesMe, 20000); // lent 300, got 100 back
  // Loans are not income or spending.
  const m = monthSummary(s, '2026-10');
  assert.equal(m.income, 50000);
  assert.equal(m.expense, 0);
  assert.equal(accountBalances(s).wallet, 30000);
});

test('categories can be added while logging, without duplicates', () => {
  const s = defaultState();
  const id = ensureCategory(s, 'Car rent', 'expense');
  assert.equal(ensureCategory(s, 'car RENT', 'expense'), id);
  const c = s.settings.categories.find((x) => x.id === id);
  assert.equal(c.jar, 'living');
  assert.notEqual(ensureCategory(s, 'Car rent', 'income'), id);
});

test('deleting leaves a marker for sync, undo clears it', () => {
  const s = defaultState();
  s.tx.push({ id: 'x', type: 'expense', amount: 100, date: '2026-10-01', account: 'wallet' });
  const t = removeTx(s, 'x', 123);
  assert.equal(s.deleted.x, 123);
  restoreTx(s, t, 456);
  assert.equal(s.deleted.x, undefined);
  assert.equal(s.tx[0].updatedAt, 456);
});

test('archived accounts stay out of the total and the goal', () => {
  const s = multi();
  s.settings.accounts.find((a) => a.id === 'wallet').start = 100000;
  s.settings.accounts.find((a) => a.id === 'wallet').archived = true;
  s.settings.accounts.find((a) => a.id === 'bin').holdings = [];
  assert.equal(totalBalance(s).total, 0);
  assert.equal(goalStatus(s, '2026-10-09').current, 0);
});

test('export → import keeps currency, person and loan', async () => {
  const { exportRows, importRows, toTSV } = await import('../js/importer.js');
  const { parseCSV } = await import('../js/csv.js');
  const s = multi();
  const ana = ensurePerson(s, 'Ana');
  s.tx.push(
    { id: 'u', type: 'income', amount: 50000, currency: 'USD', rate: 17.5, base: 875000, date: '2026-10-02', account: 'usd', category: 'work', note: 'client', createdAt: 1 },
    { id: 'l', type: 'expense', amount: 20000, currency: 'MDL', rate: 1, base: 20000, date: '2026-10-03', account: 'wallet', category: 'other', person: ana, loan: true, createdAt: 2 },
  );
  const fresh = multi();
  const res = importRows(parseCSV(toTSV(exportRows(s))), fresh);
  const usd = res.tx.find((t) => t.note === 'client');
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.account, 'usd');
  assert.equal(usd.base, 875000);
  const loan = res.tx.find((t) => t.loan);
  assert.equal(fresh.people.find((p) => p.id === loan.person).name, 'Ana');
});
