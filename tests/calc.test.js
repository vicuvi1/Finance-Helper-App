import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calc, formatCalc, plainAmount } from '../js/calc.js';

test('calculator: the usual sums, decimals with comma or dot', () => {
  assert.equal(calc('120+45'), 165);
  assert.equal(calc('2+3*4'), 14);
  assert.equal(calc('(2+3)*4'), 20);
  assert.equal(calc('10 ÷ 4'), 2.5);
  assert.equal(calc('7 × 3 − 1'), 20);
  assert.equal(calc('12,5 + 0.5'), 13);
  assert.equal(calc('1 200 + 300'), 1500);
  assert.equal(calc('1.234,5 + 0,5'), 1235);
  assert.equal(calc('1,234,567'), 1234567);
  assert.equal(calc('-5 + 2'), -3);
  assert.equal(calc('0.1+0.2'), 0.3);
  assert.equal(calc('45 ='), 45);
});

test('calculator: shop-style percent, and what is not a sum', () => {
  assert.equal(calc('200+10%'), 220);
  assert.equal(calc('200-10%'), 180);
  assert.equal(calc('200*10%'), 20);
  assert.equal(calc('50%'), 0.5);
  assert.equal(calc('1000-(10+10)%'), 800);
  assert.equal(calc(''), null);
  assert.equal(calc('12+'), null);
  assert.equal(calc('(2+3'), null);
  assert.equal(calc('5/0'), null);
  assert.equal(calc('abc'), null);
});

test('calculator: numbers written like the rest of the app', () => {
  assert.equal(formatCalc(1234567.5), '1 234 567,5');
  assert.equal(formatCalc(-35), '−35');
  assert.equal(formatCalc(1 / 3), '0,333333');
  assert.equal(plainAmount(1234.567), '1234,57');
  assert.equal(plainAmount(165), '165');
});
