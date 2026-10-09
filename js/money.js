// Money is stored as integer bani (1 MDL = 100 bani) so sums never drift.

const LETTERS = /[^\d.,+\-*/()x×÷]/gi;

// Turns one number as people write it ("2 300MDL", "1.234,50", "12.5", "2,300")
// into bani. Returns null when there is no number.
export function parseAmount(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 100) : null;
  let s = String(text).replace(/[\s  ]/g, '').replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  const n = toNumber(s);
  if (n == null) return null;
  return Math.round((negative ? -n : n) * 100);
}

function toNumber(s) {
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the last one is the decimal mark, the other groups thousands.
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Lets the amount field work like a calculator: "120+45*2", "3800*0.7", "(50+30)/2".
// No eval: a tiny recursive-descent parser over + - * / and parentheses.
export function evalAmount(text) {
  if (text == null) return null;
  const s = String(text).replace(/[\s  ]/g, '').replace(LETTERS, '')
    .replace(/[x×]/gi, '*').replace(/÷/g, '/');
  if (!s) return null;
  if (!/[+*/()]/.test(s.slice(1)) && !/\d-/.test(s)) return parseAmount(s);
  const tokens = s.match(/\d[\d.,]*|[+\-*/()]/g);
  if (!tokens || tokens.join('') !== s) return null;
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r = term();
      if (v == null || r == null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = factor();
      if (v == null || r == null) return null;
      if (op === '/' && r === 0) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function factor() {
    const t = next();
    if (t === '-') { const v = factor(); return v == null ? null : -v; }
    if (t === '(') {
      const v = expr();
      if (next() !== ')') return null;
      return v;
    }
    if (t && /^\d/.test(t)) return toNumber(t);
    return null;
  }
  const v = expr();
  if (v == null || i !== tokens.length || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

// "2 300 MDL", "−150 MDL", "12,50 MDL". Uses non-breaking spaces so it never wraps.
export function formatMoney(cents, currency = 'MDL', { sign = false, compact = false } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  let whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let text;
  if (compact && whole >= 10000) {
    const k = whole / 1000;
    text = (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace('.', ',') + 'k';
  } else {
    text = group(whole) + (frac ? ',' + String(frac).padStart(2, '0') : '');
  }
  const prefix = neg ? '−' : sign && cents > 0 ? '+' : '';
  return prefix + text + (currency ? ' ' + currency : '');
}

function group(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Plain number for inputs and CSV ("2300.5"), no grouping.
export function centsToPlain(cents) {
  const v = cents / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

// Splits an amount by percentages; the rounding remainder goes to the first part
// so the parts always add up exactly to the total.
export function splitByPercent(cents, percents) {
  const parts = percents.map((p) => Math.floor((cents * p) / 100));
  const total = percents.reduce((a, b) => a + b, 0);
  if (total === 100 && parts.length) {
    parts[0] += cents - parts.reduce((a, b) => a + b, 0);
  }
  return parts;
}
