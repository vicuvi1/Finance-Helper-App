import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, recordFromMessage, loggedText, quickKeyboard, reminderText, billsText, recordDay, monthText, balanceText, lastText, catchUpText } from '../js/telegram.js';
import { blocks, blockLabel, matchBlock, blockFields, blockFromText, upsertBlock, removeBlock, moveBlock, blockKeyboard } from '../js/blocks.js';
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

test('keyboard from your blocks, reminders', () => {
  const s = state();
  const kb = quickKeyboard(s);
  assert.equal(kb.keyboard[0][0].text, '☕ Coffee 20');
  assert.equal(kb.keyboard[0].length, 3);
  assert.deepEqual(kb.keyboard.at(-2).map((b) => b.text), ['📊 Today', '📅 Month', '💰 Balance']);
  assert.deepEqual(kb.keyboard.at(-1).map((b) => b.text), ['🧾 Last', '↩️ Undo', '❓ Help']);
  assert.match(reminderText(s, '2026-10-10'), /Time to log/);
  assert.match(reminderText(s, '2026-10-02'), /logged 1 record/);
  s.recurring = [{ id: 'r', type: 'expense', amount: 450000, currency: 'MDL', account: 'maib', category: 'home', note: 'rent', every: 'month', start: '2026-09-11', lastDone: '2026-09-11' }];
  assert.match(billsText(s, '2026-10-10'), /Tomorrow · rent −4\s500\sMDL/);
  assert.match(billsText(s, '2026-10-20'), /Overdue · rent/);
  s.recurring[0].lastDone = '2026-10-11';
  assert.equal(billsText(s, '2026-10-20'), null);
});

test('blocks: tap logs the block, editable list, add from the chat', () => {
  const s = state();
  const coffee = matchBlock(s, '☕ Coffee 20');
  assert.equal(coffee.id, 'b-coffee');
  assert.equal(matchBlock(s, 'coffee').id, 'b-coffee'); // just the name
  assert.equal(matchBlock(s, 'coffee 35'), null); // another amount: parsed as text
  const f = blockFields(s, coffee);
  assert.deepEqual([f.type, f.amount, f.note, f.category, f.account], ['expense', 2000, 'Coffee', 'food', 'maib']); // the account used last for coffee
  upsertBlock(s, { ...coffee, emoji: '🧋', amount: 2500 }, 10);
  assert.equal(blockLabel(blocks(s)[0]), '🧋 Coffee 25');
  assert.equal(s.settings.updatedAt, 10); // syncs as a setting
  const pizza = blockFromText(s, '/addblock 🍕 pizza 120,50', 11);
  assert.deepEqual([pizza.emoji, pizza.name, pizza.amount, pizza.type], ['🍕', 'Pizza', 12050, 'expense']);
  assert.equal(blockFromText(s, '+ Tips 100', 12).type, 'income');
  assert.equal(blockFromText(s, '/addblock pizza', 12), null);
  upsertBlock(s, pizza, 13);
  assert.equal(blocks(s).at(-1).id, pizza.id);
  moveBlock(s, pizza.id, -1, 14);
  assert.equal(blocks(s).at(-2).id, pizza.id);
  removeBlock(s, 'b-kebab', 15);
  assert.ok(!blocks(s).some((b) => b.id === 'b-kebab'));
  assert.equal(blockKeyboard(s).keyboard.flat().filter((b) => b.text === '🍕 Pizza 120,5').length, 1);
});

test('yesterday, month, balance, last and the catch-up summary', () => {
  const s = state();
  const f = parseQuick('coffee 35 yesterday', s);
  assert.equal(f.amount, 3500);
  assert.equal(f.note, 'coffee');
  assert.equal(recordDay('2026-10-10', f), '2026-10-09');
  assert.equal(recordDay('2026-10-10', parseQuick('ieri taxi 50', s)), '2026-10-09');
  assert.equal(recordDay('2026-10-10', parseQuick('taxi 50', s)), '2026-10-10');
  s.tx.push({ id: 'i', type: 'income', amount: 1000000, currency: 'MDL', date: '2026-10-03', category: 'work', account: 'maib', note: 'project', createdAt: 3, updatedAt: 3 });
  const m = monthText(s, '2026-10-10');
  assert.match(m, /October.*day 10/);
  assert.match(m, /Earned <b>\+10\s000\sMDL/);
  assert.match(m, /Kept <b>9\s930\sMDL<\/b> \(99% of income\)/);
  assert.match(m, /Food 70\sMDL · 100%/);
  const b = balanceText(s);
  assert.match(b, /All my money: <b>9\s930\sMDL/);
  assert.match(b, /maib Visa: <b>9\s930\sMDL/);
  assert.match(lastText(s), /Last 3.*Sat 3 · \+10\s000\sMDL · project/s);
  const t = recordFromMessage(parseQuick('coffee 20', s), { updateId: 5, date: '2026-10-09', currency: 'MDL' });
  s.tx.push(t);
  assert.match(catchUpText(s, [t], '2026-10-10'), /Synced 1 record.*Fri 9 · −20\sMDL · coffee/s);
  assert.match(loggedText(s, t), /Spent that day: <b>20\sMDL<\/b>.*Food this month: 90\sMDL/s);
});
