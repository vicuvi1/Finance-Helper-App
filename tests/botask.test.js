import test from 'node:test';
import assert from 'node:assert/strict';
import { readPeriod, readSubject, isQuestion, answer, splitRecords, readReminder } from '../js/botask.js';
import { defaultState } from '../js/model.js';

const TODAY = '2026-11-22';
const plain = (a) => a.text.replace(/<[^>]+>/g, '').replace(/\s/g, ' ');
function st() {
  const s = defaultState();
  const acc = s.settings.accounts[0].id;
  const food = s.settings.categories.find((c) => /food/i.test(c.name));
  const transport = s.settings.categories.find((c) => /transport/i.test(c.name));
  let n = 0;
  const add = (date, amount, category, note, type = 'expense') => s.tx.push({ id: `t${n++}`, date, type, amount, currency: 'MDL', account: acc, category, note, createdAt: 1, updatedAt: 1 });
  add('2026-11-03', 25000, food.id, 'Linella');
  add('2026-11-10', 12000, food.id, 'Andys');
  add('2026-11-12', 4500, transport.id, 'taxi');
  add('2026-10-05', 20000, food.id, 'Linella');
  add('2026-10-20', 9000, transport.id, 'taxi home');
  add('2026-11-01', 2000000, s.settings.categories.find((c) => c.type === 'income').id, 'salary', 'income');
  return { s, food, transport };
}

test('periods in three languages', () => {
  assert.equal(readPeriod('food this month', TODAY).from, '2026-11-01');
  assert.equal(readPeriod('taxi last month', TODAY).from, '2026-10-01');
  assert.equal(readPeriod('how much on taxi in October', TODAY).label, 'October 2026');
  assert.equal(readPeriod('mancare luna trecuta', TODAY).from, '2026-10-01');
  assert.equal(readPeriod('такси в октябре', TODAY).from, '2026-10-01');
  assert.equal(readPeriod('food in december', TODAY).from, '2025-12-01', 'a month still ahead means last year');
  assert.equal(readPeriod('food since september', TODAY).from, '2026-09-01');
  assert.equal(readPeriod('food this week', TODAY).from, '2026-11-16');
});

test('questions vs records', () => {
  assert.equal(isQuestion('food this month'), true);
  assert.equal(isQuestion('how much on taxi'), true);
  assert.equal(isQuestion('and last month?'), true);
  assert.equal(isQuestion('taxi 45'), false);
  assert.equal(isQuestion('yesterday 120 lunch'), false);
  assert.equal(isQuestion('120 lunch today'), false);
});

test('answers: category, shop, follow-ups, top, income', () => {
  const { s, food } = st();
  const a = answer(s, 'food this month', TODAY);
  assert.match(plain(a), /On Food.*this month.*370 MDL.*2 records/);
  assert.equal(a.ctx.subject.id, food.id);
  const b = answer(s, 'and last month?', TODAY, a.ctx);
  assert.match(plain(b), /On Food.*October 2026.*200 MDL/);
  const c = answer(s, 'and taxi?', TODAY, b.ctx);
  assert.match(plain(c), /[Tt]axi.*October 2026.*90 MDL/);
  assert.match(plain(answer(s, 'how much at linella in october', TODAY)), /200 MDL/);
  assert.match(plain(answer(s, 'where did my money go this month', TODAY)), /Where it went[\s\S]*Food/);
  assert.match(plain(answer(s, 'how much did I earn this month', TODAY)), /Earned.*20 000 MDL/);
  assert.equal(answer(s, 'taxi 45', TODAY), null);
});

test('afford, left today, when is', () => {
  const { s } = st();
  s.recurring = [{ id: 'r', type: 'expense', amount: 450000, currency: 'MDL', account: s.settings.accounts[0].id, category: 'other', note: 'Rent', every: 'month', start: '2026-11-25', lastDone: '2026-11-24', auto: false, paused: false, updatedAt: 1 }];
  assert.match(plain(answer(s, 'can I afford 3000', TODAY)), /3 000 MDL/);
  assert.ok(answer(s, "what's left today", TODAY).text.length > 5);
  assert.match(plain(answer(s, 'when is rent', TODAY)), /Rent.*4 500 MDL.*25/);
});

test('several records in one message; reminders', () => {
  assert.deepEqual(splitRecords('lunch 120, taxi 45, coffee 30'), ['lunch 120', 'taxi 45', 'coffee 30']);
  assert.equal(splitRecords('120,50 lunch'), null);
  assert.equal(splitRecords('lunch, taxi 45'), null);
  assert.deepEqual(readReminder('remind me to pay internet on the 27th', TODAY), { text: 'pay internet', date: '2026-11-27' });
  assert.deepEqual(readReminder('remind me to call the bank tomorrow', TODAY), { text: 'call the bank', date: '2026-11-23' });
  assert.equal(readReminder('remind me to renew insurance on 5 january', TODAY).date, '2027-01-05');
  assert.equal(readReminder('remind me pay rent on the 3rd', TODAY).date, '2026-12-03');
  assert.equal(readReminder('напомни заплатить интернет завтра', TODAY).date, '2026-11-23');
  assert.equal(readReminder('lunch 120', TODAY), null);
});
