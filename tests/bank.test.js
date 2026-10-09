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
