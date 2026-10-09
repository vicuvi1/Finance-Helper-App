// Currencies and conversion. Rates are kept as "units per 1 USD" (the shape
// free rate APIs use), so any two currencies convert through USD. Crypto
// prices are kept as USD per coin.

export const FIAT = [
  { code: 'MDL', name: 'Moldovan leu' },
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'GBP', name: 'British pound' },
  { code: 'UAH', name: 'Ukrainian hryvnia' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'CAD', name: 'Canadian dollar' },
];
export const CRYPTO = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TON', 'USDT', 'USDC'];
// Stablecoins track the dollar; no price lookup needed.
const STABLE = { USDT: 1, USDC: 1, FDUSD: 1, BUSD: 1 };

// Units of `code` per 1 USD, or null when unknown.
export function perUsd(rates, code) {
  if (code === 'USD') return 1;
  const v = rates?.usd?.[code];
  return v > 0 ? v : null;
}

// Converts integer cents between fiat currencies. Returns null without a rate.
export function convert(cents, from, to, rates) {
  if (from === to) return cents;
  const a = perUsd(rates, from);
  const b = perUsd(rates, to);
  if (!a || !b) return null;
  return Math.round((cents / a) * b);
}

// How many `to` units one `from` unit is worth (e.g. 1 USD = 17.62 MDL).
export function pairRate(from, to, rates) {
  if (from === to) return 1;
  const a = perUsd(rates, from);
  const b = perUsd(rates, to);
  return a && b ? b / a : null;
}

// USD price of one coin.
export function coinUsd(rates, asset) {
  if (STABLE[asset]) return STABLE[asset];
  const p = rates?.crypto?.[asset];
  return p > 0 ? p : null;
}

// Value of a coin amount in any fiat currency, as integer cents.
export function coinValue(qty, asset, to, rates) {
  const usd = coinUsd(rates, asset);
  if (usd == null || !Number.isFinite(qty)) return null;
  return convert(Math.round(qty * usd * 100), 'USD', to, rates);
}

// Human rate, enough digits to be useful: 17.6234 → "17.62", 0.0567 → "0.0567".
export function formatRate(r) {
  if (r == null) return '–';
  if (r >= 100) return r.toFixed(2);
  if (r >= 1) return r.toFixed(r >= 10 ? 2 : 4).replace(/0+$/, '').replace(/\.$/, '');
  return r.toPrecision(4);
}

export function formatQty(q) {
  if (!Number.isFinite(q)) return '–';
  const abs = Math.abs(q);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return q.toFixed(digits).replace(/\.?0+$/, '');
}
