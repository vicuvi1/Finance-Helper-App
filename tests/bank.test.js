import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessMapping, parseStatement, signature } from '../js/bank.js';
import { defaultState } from '../js/model.js';
import { parseCSV } from '../js/csv.js';

// Made-up statements in the shapes banks export.
const RO = `Extras de cont;;;;;
Client: EXEMPLU;;;;;
Perioada: 01.09.2026 - 30.09.2026;;;;;
;;;;;
Data tranzacţiei;Data decontării;Descrierea operaţiunii;Debit;Credit;Sold
02.09.2026 10:15;03.09.2026;Plata la LINELLA SRL Chisinau;245,50;;10 000,00
05.09.2026;05.09.2026;Transfer primit de la Client SRL;;12 500,00;22 254,50
07.09.2026;07.09.2026;Comision deservire;15,00;;22 239,50
;;Total;260,50;12 500,00;`;

const RU = `Дата операции,Описание,Сумма,Валюта,Остаток
2026-09-03 18:40,"Оплата такси Yandex","-85.00",MDL,"1 000.00"
2026-09-04 09:00,"Зачисление зарплаты","15000.00",MDL,"16 000.00"`;

test('finds the header among bank info rows and maps debit/credit', () => {
  const rows = parseCSV(RO);
  const g = guessMapping(rows);
  assert.equal(g.headerRow, 4);
  assert.deepEqual({ date: g.map.date, desc: g.map.desc, debit: g.map.debit, credit: g.map.credit }, { date: 0, desc: 2, debit: 3, credit: 4 });
  assert.equal(g.map.amount, undefined); // "Sold" (balance) is never the amount
  const s = defaultState();
  const res = parseStatement(rows, g, s, { account: 'card' });
  assert.equal(res.tx.length, 3);
  assert.deepEqual(res.tx.map((t) => [t.date, t.type, t.amount]), [['2026-09-02', 'expense', 24550], ['2026-09-05', 'income', 1250000], ['2026-09-07', 'expense', 1500]]);
  assert.equal(res.skipped, 1); // the total line
  assert.equal(res.tx[0].note, 'Plata la LINELLA SRL Chisinau');
  // Importing again finds nothing new.
  s.tx.push(...res.tx);
  assert.equal(parseStatement(rows, g, s, { account: 'card' }).duplicates, 3);
});

test('signed amount column, Russian headers, currency column', () => {
  const rows = parseCSV(RU);
  const g = guessMapping(rows);
  assert.equal(g.map.amount, 2);
  assert.equal(g.map.currency, 3);
  const res = parseStatement(rows, g, defaultState(), { account: 'wallet' });
  assert.deepEqual(res.tx.map((t) => [t.type, t.amount, t.currency]), [['expense', 8500, 'MDL'], ['income', 1500000, 'MDL']]);
  // "Expenses are positive" flips the signs.
  assert.equal(parseStatement(rows, g, defaultState(), { account: 'wallet', flip: true }).tx[0].type, 'income');
  assert.equal(signature(rows, 0), 'дата операции|описание|сумма|валюта|остаток');
});

test('no statement-like header', () => {
  assert.equal(guessMapping([['a', 'b'], ['1', '2']]), null);
});

test('a row you already logged by hand (another note) is spotted; learned categories come first', async () => {
  const { parseStatement } = await import('../js/bank.js');
  const { normalizeState } = await import('../js/model.js');
  const s = normalizeState({ tx: [{ id: 'mine', type: 'expense', amount: 34000, currency: 'MDL', account: 'cash', category: 'food', date: '2026-11-12', note: 'groceries', createdAt: 1, updatedAt: 1 }] });
  const acc = s.settings.accounts[0].id;
  s.tx[0].account = acc;
  const rows = [['Data', 'Suma', 'Descriere'], ['13.11.2026', '-340,00', 'LINELLA CHISINAU 123'], ['14.11.2026', '-55,00', 'BOLT RIDE']];
  const r = parseStatement(rows, { headerRow: 0, map: { date: 0, amount: 1, desc: 2 } }, s, { account: acc });
  assert.equal(r.tx.length, 2);
  assert.equal(r.likely, 1);
  assert.equal(r.tx[0]._likely.id, 'mine');
  assert.equal(r.tx[1]._likely, undefined);
});
