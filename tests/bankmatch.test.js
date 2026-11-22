import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement } from '../js/bank.js';
import { bankMatch, confirmMatched } from '../js/bankmatch.js';
import { defaultState } from '../js/model.js';

test('statement matched against the app: phone payments checked, the missing listed', () => {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  const base = { currency: 'MDL', account: acc, category: 'other', createdAt: 1, updatedAt: 1 };
  s.tx.push({ ...base, id: 'ph1', date: '2026-11-03', type: 'expense', amount: 12050, note: 'Linella', source: 'phone', review: true });
  s.tx.push({ ...base, id: 'me1', date: '2026-11-05', type: 'expense', amount: 5000, note: 'cafe' });
  s.tx.push({ ...base, id: 'gone', date: '2026-11-06', type: 'expense', amount: 7700, note: 'made-up only in the app' });
  s.tx.push({ ...base, id: 'old', date: '2026-10-01', type: 'expense', amount: 100, note: 'before the statement' });
  const rows = [['Date', 'Description', 'Amount'], ['03.11.2026', 'LINELLA SRL', '-120,50'], ['05.11.2026', 'cafe', '-50,00'], ['07.11.2026', 'NEW SHOP', '-30,00']];
  const res = parseStatement(rows, { headerRow: 0, map: { date: 0, desc: 1, amount: 2 } }, s, { account: acc });
  assert.equal(res.from, '2026-11-03');
  assert.equal(res.to, '2026-11-07');
  const likely = res.tx.filter((t) => t._likely).map((t) => t._likely.id);
  const m = bankMatch(s, res, likely);
  assert.ok(m.matched.includes('ph1'));
  assert.ok(m.matched.includes('me1'));
  assert.deepEqual(m.missing.map((t) => t.id), ['gone']);
  assert.equal(confirmMatched(s, m.matched, '2026-11-22', 9), 1);
  assert.equal(s.tx.find((t) => t.id === 'ph1').review, undefined);
  assert.equal(s.tx.find((t) => t.id === 'ph1').bankOk, '2026-11-22');
});
