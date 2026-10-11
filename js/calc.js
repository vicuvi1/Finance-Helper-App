// The floating calculator's math (pure, tested). No eval: a small parser for
// + − × ÷, brackets, decimals with "," or ".", spaces as thousand
// separators, and shop-style percent:
//   200+10%  -> 220     (add 10% of 200)
//   200-10%  -> 180
//   200*10%  -> 20      (10% of 200)
//   50%      -> 0.5

const OPS = { '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', 'x': '*', 'X': '*', '/': '/', '÷': '/', ':': '/' };

function tokenize(text) {
  const s = String(text || '').replace(/(\d)[\s  ]+(?=\d{3}(\D|$))/g, '$1'); // 1 200 -> 1200
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[\d.,]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.,]/.test(s[j])) j++;
      let num = s.slice(i, j);
      // "1.234,5" or "1,234.5": the last separator is the decimal one.
      const lastSep = Math.max(num.lastIndexOf(','), num.lastIndexOf('.'));
      if (lastSep >= 0) {
        const intPart = num.slice(0, lastSep).replace(/[.,]/g, '');
        const frac = num.slice(lastSep + 1);
        // "1,200" or "1.200" with exactly three digits after and more before: a thousands mark.
        num = frac.length === 3 && intPart.length && num.split(/[.,]/).length > 2 ? intPart + frac : `${intPart || '0'}.${frac}`;
      }
      const v = Number(num);
      if (!Number.isFinite(v)) throw new Error('bad number');
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (c === '%') { out.push({ t: '%' }); i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    if (OPS[c]) { out.push({ t: 'op', v: OPS[c] }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

// Recursive descent: expr = term (('+'|'-') term[%])*, term = factor (('*'|'/') factor)*.
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const take = () => tokens[p++];

  function primary() {
    const tk = take();
    if (!tk) throw new Error('incomplete');
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) { const v = primary(); return { v: tk.v === '-' ? -v.v : v.v, pct: v.pct }; }
    if (tk.t === 'num') {
      if (peek()?.t === '%') { take(); return { v: tk.v / 100, pct: true }; }
      return { v: tk.v, pct: false };
    }
    if (tk.t === '(') {
      const v = expr();
      if (take()?.t !== ')') throw new Error('missing )');
      if (peek()?.t === '%') { take(); return { v: v / 100, pct: true }; }
      return { v, pct: false };
    }
    throw new Error('unexpected');
  }

  function term() {
    let left = primary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = take().v;
      const right = primary();
      if (op === '/' && right.v === 0) throw new Error('÷ 0');
      left = { v: op === '*' ? left.v * right.v : left.v / right.v, pct: false };
    }
    return left;
  }

  function expr() {
    let acc = term().v;
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v;
      const right = term();
      // "+ 10%" means ten percent of what came before.
      const amount = right.pct ? acc * right.v : right.v;
      acc = op === '+' ? acc + amount : acc - amount;
    }
    return acc;
  }

  const v = expr();
  if (p < tokens.length) throw new Error('unexpected');
  return v;
}

// The value of an expression, or null when it isn't one (yet).
export function calc(text) {
  const t = String(text || '').trim().replace(/[=\s]+$/, '');
  if (!t) return null;
  try {
    const v = parse(tokenize(t));
    return Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : null;
  } catch {
    return null;
  }
}

// 1234567.5 -> "1 234 567,5" (as the rest of the app writes numbers).
export function formatCalc(v, maxDecimals = 6) {
  if (v == null || !Number.isFinite(v)) return '';
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(maxDecimals).replace(/\.?0+$/, '');
  const [int, frac] = fixed.split('.');
  return `${neg ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${frac ? `,${frac}` : ''}`;
}

// For an amount field: plain, no spaces, 2 decimals at most ("1234,5").
export const plainAmount = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
