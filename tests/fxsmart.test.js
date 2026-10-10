import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateAdvice, rateSeries, adviceText } from '../js/fxsmart.js';
import { recordRates } from '../js/rates.js';
import { defaultState } from '../js/model.js';
import { addDays } from '../js/dates.js';

const today = '2026-10-10';
function withHistory(values, now) {
  const s = defaultState();
  s.rates = { usd: { MDL: now, USD: 1 } };
  values.forEach((v, i) => recordRates(s.rates, addDays(today, -(values.length - i)), { MDL: v, USD: 1 }));
  return s;
}

test('high, low and ordinary days', () => {
  const hist = Array.from({ length: 20 }, (_, i) => 17 + (i % 5) * 0.1); // 17.0 .. 17.4
  const hi = rateAdvice(withHistory(hist, 17.5), 'USD', today);
  assert.equal(hi.verdict, 'high');
  assert.equal(hi.pct, 1);
  assert.match(adviceText(hi, "USD", "MDL"), /^Good day to convert: 1 USD = 17\.50 MDL.*the highest in 90 days/);
  assert.equal(rateAdvice(withHistory(hist, 16.9), 'USD', today).verdict, 'low');
  assert.equal(rateAdvice(withHistory(hist, 17.2), 'USD', today).verdict, 'normal');
});

test('too little history; own records count', () => {
  const s = withHistory([17, 17.1], 17.2);
  assert.equal(rateAdvice(s, 'USD', today).verdict, 'unknown');
  for (let i = 3; i < 9; i++) s.tx.push({ id: `t${i}`, type: 'income', amount: 100, currency: 'USD', rate: 16.8, date: addDays(today, -i * 3) });
  assert.equal(rateSeries(s, 'USD', today).length, 8);
  assert.equal(rateAdvice(s, 'USD', today).verdict, 'high');
});

test('history keeps 400 days and only fiat', () => {
  const r = { usd: {} };
  for (let i = 0; i < 410; i++) recordRates(r, addDays(today, -i), { MDL: 17, USD: 1, BTC: 0.00001 });
  assert.equal(Object.keys(r.history).length, 400);
  assert.deepEqual(Object.keys(r.history[today]).sort(), ['MDL', 'USD']);
});
