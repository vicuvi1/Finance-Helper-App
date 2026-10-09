import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, evalAmount, formatMoney, splitByPercent, centsToPlain } from '../js/money.js';

test('parseAmount reads amounts the way the sheet shows them', () => {
  assert.equal(parseAmount('150MDL'), 15000);
  assert.equal(parseAmount('2 300MDL'), 230000);
  assert.equal(parseAmount('12 480MDL'), 1248000);
  assert.equal(parseAmount('0MDL'), 0);
  assert.equal(parseAmount('26600'), 2660000);
  assert.equal(parseAmount('12,50'), 1250);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('2,300'), 230000);
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('MDL'), null);
  assert.equal(parseAmount(null), null);
});

test('evalAmount works like a calculator', () => {
  assert.equal(evalAmount('120+45*2'), 21000);
  assert.equal(evalAmount('3800*0.7'), 266000);
  assert.equal(evalAmount('3800 x 10%'.replace('%', '/100')), 38000);
  assert.equal(evalAmount('(50+30)/2'), 4000);
  assert.equal(evalAmount('2 300'), 230000);
  assert.equal(evalAmount('100-30'), 7000);
  assert.equal(evalAmount('10/0'), null);
  assert.equal(evalAmount('5+'), null);
  assert.equal(evalAmount('abc'), null);
});

test('formatMoney groups thousands and never wraps', () => {
  assert.equal(formatMoney(2446500), '24 465 MDL');
  assert.equal(formatMoney(-660500), '−6 605 MDL');
  assert.equal(formatMoney(1250), '12,50 MDL');
  assert.equal(formatMoney(5000, 'MDL', { sign: true }), '+50 MDL');
  assert.equal(formatMoney(10000000, '', { compact: true }), '100k');
  assert.equal(formatMoney(1250000, '', { compact: true }), '12,5k');
});

test('splitByPercent always adds up exactly', () => {
  assert.deepEqual(splitByPercent(380000, [70, 10, 10, 10]), [266000, 38000, 38000, 38000]);
  const parts = splitByPercent(333, [70, 10, 10, 10]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 333);
});

test('centsToPlain', () => {
  assert.equal(centsToPlain(230000), '2300');
  assert.equal(centsToPlain(1250), '12.50');
});
