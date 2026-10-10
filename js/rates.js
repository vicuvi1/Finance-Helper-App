// Live exchange rates and coin prices. Each source has a pure parser (tested
// with sample payloads) and refreshRates() ties them together. Network calls
// go through `fetchText`, which the desktop app routes through its main
// process so no website can block them.

import { CRYPTO, FIAT } from './fx.js';

export const URLS = {
  fiat: 'https://open.er-api.com/v6/latest/USD',
  // Official rates of the National Bank of Moldova (desktop app only: the
  // site does not allow calls from web pages).
  bnm: (ddmmyyyy) => `https://www.bnm.md/en/official_exchange_rates?get_xml=1&date=${ddmmyyyy}`,
  binance: (symbols) => `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
  coingecko: (ids) => `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
};

const GECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple',
  ADA: 'cardano', DOGE: 'dogecoin', TON: 'the-open-network', TRX: 'tron', DOT: 'polkadot',
  LTC: 'litecoin', AVAX: 'avalanche-2', LINK: 'chainlink', MATIC: 'matic-network',
};

// open.er-api.com: { result: "success", time_last_update_unix, rates: { MDL: 17.6, ... } }
export function parseErApi(text) {
  const j = JSON.parse(text);
  if (j.result !== 'success' || !j.rates || j.base_code && j.base_code !== 'USD') throw new Error('Unexpected rate data');
  const usd = {};
  for (const [k, v] of Object.entries(j.rates)) if (v > 0) usd[k] = v;
  const date = j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : null;
  return { usd, date };
}

// BNM XML: <ValCurs Date="09.10.2026"><Valute><CharCode>USD</CharCode>
// <Nominal>1</Nominal><Value>17.6234</Value></Valute>... Value is MDL per
// Nominal units. Returns MDL per 1 unit of each currency.
export function parseBnm(xml) {
  const mdlPer = {};
  const re = /<Valute[^>]*>([\s\S]*?)<\/Valute>/g;
  let m;
  while ((m = re.exec(xml))) {
    const code = /<CharCode>\s*([A-Z]{3})\s*<\/CharCode>/.exec(m[1])?.[1];
    const nominal = Number(/<Nominal>\s*([\d.,]+)\s*<\/Nominal>/.exec(m[1])?.[1]?.replace(',', '.') || 1);
    const value = Number(/<Value>\s*([\d.,]+)\s*<\/Value>/.exec(m[1])?.[1]?.replace(',', '.'));
    if (code && value > 0 && nominal > 0) mdlPer[code] = value / nominal;
  }
  const d = /<ValCurs[^>]*Date="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!mdlPer.USD) throw new Error('No USD rate in BNM data');
  return { mdlPer, date: d ? `${d[3]}-${d[2]}-${d[1]}` : null };
}

// Turns "MDL per unit" into "units per USD" so it merges with other sources.
export function bnmToUsd(mdlPer) {
  const usd = { MDL: mdlPer.USD };
  for (const [code, v] of Object.entries(mdlPer)) usd[code] = code === 'USD' ? 1 : mdlPer.USD / v;
  usd.USD = 1;
  return usd;
}

// Binance: [{ symbol: "BTCUSDT", price: "62000.10" }, ...] -> { BTC: 62000.1 }
export function parseBinance(text) {
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error(arr?.msg || 'Unexpected Binance data');
  const out = {};
  for (const { symbol, price } of arr) {
    if (symbol?.endsWith('USDT') && Number(price) > 0) out[symbol.slice(0, -4)] = Number(price);
  }
  return out;
}

// CoinGecko: { bitcoin: { usd: 62000 } } -> { BTC: 62000 }
export function parseCoingecko(text) {
  const j = JSON.parse(text);
  const out = {};
  for (const [asset, id] of Object.entries(GECKO_IDS)) if (j[id]?.usd > 0) out[asset] = j[id].usd;
  return out;
}

export function coinsToPrice(state) {
  const held = state.settings.accounts.flatMap((a) => (a.holdings || []).map((h) => h.asset));
  return [...new Set([...CRYPTO, ...held])].filter((a) => !['USDT', 'USDC', 'FDUSD', 'BUSD'].includes(a));
}

const defaultFetchText = async (url) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

// Refreshes state.rates in place. Keeps the old values for anything that
// fails, so going offline never wipes known rates. Returns what happened.
export async function refreshRates(state, { fetchText = defaultFetchText, now = new Date(), bnm = false } = {}) {
  const prev = state.rates || {};
  const next = { usd: { ...(prev.usd || {}) }, crypto: { ...(prev.crypto || {}) }, sources: { ...(prev.sources || {}) }, history: { ...(prev.history || {}) } };
  const errors = [];

  try {
    const { usd, date } = parseErApi(await fetchText(URLS.fiat));
    Object.assign(next.usd, usd);
    next.sources.fiat = { name: 'open.er-api.com', date };
  } catch (e) {
    errors.push(`Exchange rates: ${e.message}`);
  }
  if (bnm) {
    try {
      const { mdlPer, date } = parseBnm(await fetchText(URLS.bnm(ddmmyyyy(now))));
      Object.assign(next.usd, bnmToUsd(mdlPer));
      next.sources.mdl = { name: 'National Bank of Moldova', date };
    } catch (e) {
      errors.push(`BNM: ${e.message}`);
    }
  }

  const coins = coinsToPrice(state);
  try {
    Object.assign(next.crypto, parseBinance(await fetchText(URLS.binance(coins.map((c) => `${c}USDT`)))));
    next.sources.crypto = { name: 'Binance' };
  } catch {
    try {
      Object.assign(next.crypto, parseCoingecko(await fetchText(URLS.coingecko(coins.map((c) => GECKO_IDS[c]).filter(Boolean)))));
      next.sources.crypto = { name: 'CoinGecko' };
    } catch (e2) {
      errors.push(`Crypto prices: ${e2.message}`);
    }
  }

  const gotSomething = errors.length < (bnm ? 3 : 2);
  if (gotSomething) {
    next.fetchedAt = now.getTime();
    recordRates(next, ymd(now));
  } else next.fetchedAt = prev.fetchedAt || null;
  state.rates = next;
  return { ok: errors.length === 0, partial: gotSomething && errors.length > 0, errors };
}

// ---------- Rate history (for "is today a good day to convert?") ----------

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const KEEP_DAYS = 400;

// Today's fiat rates (units per USD) saved under the date; the oldest go
// after ~13 months. Device-only, like the rates themselves.
export function recordRates(rates, date, usd = rates.usd) {
  const snap = {};
  for (const { code } of FIAT) if (usd?.[code] > 0) snap[code] = Math.round(usd[code] * 1e6) / 1e6;
  if (!Object.keys(snap).length) return;
  rates.history = { ...(rates.history || {}), [date]: snap };
  const dates = Object.keys(rates.history).sort();
  for (const d of dates.slice(0, Math.max(0, dates.length - KEEP_DAYS))) delete rates.history[d];
}

// Desktop: fill in the last ~90 days from the National Bank (one day a
// week) the first time, so the advice works from day one.
export async function backfillRates(state, { fetchText = defaultFetchText, now = new Date(), days = 91, step = 7 } = {}) {
  if (!state.rates?.usd) return 0;
  const have = Object.keys(state.rates.history || {});
  const from = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  if (have.filter((d) => d >= from).length >= 10) return 0;
  let got = 0;
  for (let back = step; back <= days; back += step) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    try {
      const { mdlPer, date } = parseBnm(await fetchText(URLS.bnm(ddmmyyyy(d))));
      recordRates(state.rates, date || ymd(d), bnmToUsd(mdlPer));
      got++;
    } catch {
      // A missing day is fine; the advice uses what it has.
    }
  }
  return got;
}
