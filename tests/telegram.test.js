import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, recordFromMessage, loggedText, quickKeyboard, reminderText, billsText } from '../js/telegram.js';
import { defaultState } from '../js/model.js';

function state() {
  const s = defaultState();
  s.settings.accounts.push({ id: 'maib', name: 'maib Visa', bank: 'maib', kind: 'card', currency: 'MDL', start: 0, color: 1, holdings: [] });
  s.tx.push({ id: 'a', type: 'expense', amount: 3500, currency: 'MDL', date: '2026-10-01', category: 'food', account: 'maib', note: 'coffee', createdAt: 1, updatedAt: 1 });
  s.tx.push({ id: 'b', type: 'expense', amount: 3500, currency: 'MDL', date: '2026-10-02', category: 'food', account: 'maib', note: 'coffee', createdAt: 2, updatedAt: 2 });
  return s;
}

test('reads the usual ways of writing a record', () => {
  const s = state();
  assert.deepEqual(parseQuick('coffee 20', s), { type: 'expense', amount: 2000, note: 'coffee', account: 'maib', category: 'food' });
  assert.equal(parseQuick('20 coffee', s).note, 'coffee');
  assert.equal(parseQuick('coffee 20 lei', s).amount, 2000);
  assert.equal(parseQuick('groceries 120+45', s).amount, 16500);
  assert.equal(parseQuick('taxi 45,50', s).amount, 4550);
  const taxi = parseQuick('taxi 45 cash', s);
  assert.equal(taxi.account, 'wallet');
  assert.equal(taxi.note, 'taxi');
  assert.equal(taxi.category, 'transport');
  assert.equal(parseQuick('lunch 120 maib', s).account, 'maib');
  const inc = parseQuick('+500 from mom', s);
  assert.equal(inc.type, 'income');
  assert.equal(inc.amount, 50000);
  assert.equal(parseQuick('salary 15000', s).type, 'income');
  assert.equal(parseQuick('☕ coffee 35', s).amount, 3500); // a quick button
  assert.equal(parseQuick('hello there', s), null);
  assert.equal(parseQuick('/today', s), null);
});

test('records get the message id, replies are short', () => {
  const s = state();
  const t = recordFromMessage(parseQuick('coffee 35', s), { updateId: 77, date: '2026-10-10', currency: 'MDL', now: 5 });
  assert.equal(t.id, 'tg-77');
  assert.equal(t.base, 3500);
  s.tx.push(t);
  assert.match(loggedText(s, t), /−35\sMDL.*coffee/s);
});

test('keyboard from quick picks, reminders', () => {
  const s = state();
  const kb = quickKeyboard(s, '2026-10-10');
  assert.equal(kb.keyboard[0][0].text, 'coffee 35');
  assert.deepEqual(kb.keyboard.at(-1).map((b) => b.text), ['📊 Today', '💰 Balance', '↩️ Undo']);
  assert.match(reminderText(s, '2026-10-10'), /Time to log/);
  assert.match(reminderText(s, '2026-10-02'), /logged 1 record/);
  s.recurring = [{ id: 'r', type: 'expense', amount: 450000, currency: 'MDL', account: 'maib', category: 'home', note: 'rent', every: 'month', start: '2026-09-11', lastDone: '2026-09-11' }];
  assert.match(billsText(s, '2026-10-10'), /Tomorrow · rent −4\s500\sMDL/);
  assert.match(billsText(s, '2026-10-20'), /Overdue · rent/);
  s.recurring[0].lastDone = '2026-10-11';
  assert.equal(billsText(s, '2026-10-20'), null);
});
