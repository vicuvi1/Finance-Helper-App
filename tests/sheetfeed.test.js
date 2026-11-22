import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsCSV, monthsCSV } from '../js/sheetfeed.js';
import { defaultState } from '../js/model.js';

const st = () => {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  const exp = s.settings.categories.find((c) => c.type === 'expense' || !c.type)?.id;
  s.tx = [
    { id: 'a', date: '2026-10-03', type: 'expense', amount: 12050, currency: 'MDL', account: acc, category: exp, note: 'made-up, "lunch"', createdAt: 1, updatedAt: 1 },
    { id: 'b', date: '2026-11-02', type: 'expense', amount: 500, currency: 'MDL', account: acc, category: exp, note: '=HYPERLINK("x")', createdAt: 2, updatedAt: 2 },
  ];
  return s;
};

test('records: header, newest first, quotes and no formulas', () => {
  const lines = recordsCSV(st()).trim().split('\r\n');
  assert.equal(lines[0], 'Date,Type,Amount,Currency,Account,To account,Category,Note');
  assert.match(lines[1], /^2026-11-02,expense,5\.00,MDL,/);
  assert.match(lines[1], /,"'=HYPERLINK\(""x""\)"$/);
  assert.match(lines[2], /,120\.50,MDL,.*,"made-up, ""lunch"""$/);
});

test('months: one line per month back to the first record', () => {
  const lines = monthsCSV(st(), '2026-11-22').trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^2026-11,0\.00,5\.00,-5\.00,/);
  assert.match(lines[2], /^2026-10,0\.00,120\.50,/);
});
