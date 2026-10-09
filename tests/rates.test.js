import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseErApi, parseBnm, bnmToUsd, parseBinance, parseCoingecko, refreshRates, URLS } from '../js/rates.js';
import { defaultState } from '../js/model.js';
import { convert } from '../js/fx.js';

const ER = JSON.stringify({ result: 'success', base_code: 'USD', time_last_update_unix: 1791504000, rates: { USD: 1, MDL: 17.6, EUR: 0.86, RON: 4.3 } });
const BNM = `<?xml version="1.0" encoding="UTF-8"?>
<ValCurs Date="09.10.2026" name="Official exchange rate">
  <Valute ID="47"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>Euro</Name><Value>20.4651</Value></Valute>
  <Valute ID="44"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>US Dollar</Name><Value>17.5823</Value></Valute>
  <Valute ID="36"><NumCode>980</NumCode><CharCode>UAH</CharCode><Nominal>10</Nominal><Name>Hryvnia</Name><Value>4.2510</Value></Valute>
</ValCurs>`;
const BINANCE = JSON.stringify([{ symbol: 'BTCUSDT', price: '61234.50000000' }, { symbol: 'ETHUSDT', price: '2450.10' }]);

test('parses open.er-api.com', () => {
  const { usd, date } = parseErApi(ER);
  assert.equal(usd.MDL, 17.6);
  assert.equal(date, '2026-10-09');
  assert.throws(() => parseErApi('{"result":"error"}'));
});

test('parses the National Bank of Moldova XML, including nominal 10', () => {
  const { mdlPer, date } = parseBnm(BNM);
  assert.equal(date, '2026-10-09');
  assert.equal(mdlPer.USD, 17.5823);
  assert.ok(Math.abs(mdlPer.UAH - 0.4251) < 1e-9);
  const usd = bnmToUsd(mdlPer);
  assert.equal(usd.MDL, 17.5823);
  // 1 EUR in MDL through the USD table equals the official EUR rate.
  assert.equal(convert(100, 'EUR', 'MDL', { usd }), 2047);
});

test('parses Binance and CoinGecko prices', () => {
  assert.deepEqual(parseBinance(BINANCE), { BTC: 61234.5, ETH: 2450.1 });
  assert.throws(() => parseBinance('{"code":0,"msg":"Service unavailable from a restricted location"}'), /restricted/);
  assert.deepEqual(parseCoingecko('{"bitcoin":{"usd":60000},"ethereum":{"usd":2400}}'), { BTC: 60000, ETH: 2400 });
});

test('refreshRates merges sources and falls back to CoinGecko', async () => {
  const s = defaultState();
  const fetchText = async (url) => {
    if (url === URLS.fiat) return ER;
    if (url.includes('bnm.md')) return BNM;
    if (url.includes('api.binance.com')) throw new Error('HTTP 451');
    if (url.includes('coingecko')) return '{"bitcoin":{"usd":60000}}';
    throw new Error('unexpected');
  };
  const res = await refreshRates(s, { fetchText, bnm: true, now: new Date('2026-10-09T10:00:00Z') });
  assert.equal(res.ok, true);
  assert.equal(s.rates.usd.MDL, 17.5823); // official rate wins for MDL
  assert.equal(s.rates.usd.RON, 4.3);
  assert.equal(s.rates.crypto.BTC, 60000);
  assert.equal(s.rates.sources.crypto.name, 'CoinGecko');
});

test('going offline keeps the last known rates', async () => {
  const s = defaultState();
  s.rates = { usd: { MDL: 17 }, crypto: { BTC: 1 }, fetchedAt: 5 };
  const res = await refreshRates(s, { fetchText: async () => { throw new Error('offline'); } });
  assert.equal(res.ok, false);
  assert.equal(s.rates.usd.MDL, 17);
  assert.equal(s.rates.fetchedAt, 5);
});
