// Split one record (#2). A record can carry `splits`: two or more lines, each
// with a category, an amount and maybe a note (a #tag in it), an income source
// (`incomeSource`, js/incomesources.js) or a subcategory. The lines must add up to the record's amount. It stays ONE
// record (one balance change, one row in the Log), but every total that looks
// at categories, tags or notes counts its lines instead: a 600 MDL shop split
// 400 Food / 200 Home is 400 in Food and 200 in Home.
//
// The one helper every totals path shares is `expandSplits(list)` (or
// `linesOf(state)`): it swaps each split record for its lines. A line is a copy
// of the record with the line's category, amount and note, and its share of the
// record's value in the main currency (`base`, the last line takes the
// rounding), so the sum of the lines is exactly the record: balances, Spent,
// Earned and net do not move at all; only the per-category split changes.
// A line keeps the record's id (opening it opens the record) and says which
// line it is (`lineOf`, `line`).
//
// A record whose lines do not add up (edited somewhere that does not know
// about lines) is counted as one plain record, so totals never drift; the Log
// shows it with "Lines don't add up". Pure; tested (web/financeSplits.test.ts).

const LINE_KEYS = ['category', 'amount', 'note', 'incomeSource', 'sub'];

/** Can this record be split? Spent or Earned, not a loan, a move, an adjustment or a points buy. */
export const canSplit = (t) => !!t && (t.type === 'expense' || t.type === 'income') && !t.loan && !t.reconcile && !String(t.id || '').startsWith('life-reward-');

/** The record's lines when they are good (two or more, each above 0 with a category, adding up), else null. */
export function validLines(t) {
  if (!canSplit(t) || !Array.isArray(t.splits) || t.splits.length < 2) return null;
  let sum = 0;
  for (const l of t.splits) {
    if (!l || typeof l !== 'object' || !Number.isSafeInteger(l.amount) || l.amount <= 0 || typeof l.category !== 'string' || !l.category) return null;
    sum += l.amount;
  }
  return sum === t.amount ? t.splits : null;
}

export const isSplit = (t) => !!validLines(t);
/** Has lines, but they are broken (do not add up): shown as a warning, counted as one record. */
export const brokenSplit = (t) => Array.isArray(t?.splits) && t.splits.length > 0 && !validLines(t);

/** Each line's share of `whole` (the record's base), the last one taking the rounding. */
export function shares(lines, total, whole) {
  let left = whole;
  return lines.map((l, i) => {
    if (i === lines.length - 1) return left;
    const v = total ? Math.round((l.amount * whole) / total) : 0;
    left -= v;
    return v;
  });
}

/** The record as its lines (a record that is not split: itself, alone). */
export function splitLines(t) {
  const lines = validLines(t);
  if (!lines) return [t];
  const whole = Number.isInteger(t.base) ? t.base : t.amount;
  const base = shares(lines, t.amount, whole);
  return lines.map((l, i) => {
    const out = { ...t, amount: l.amount, base: base[i], category: l.category, lineOf: t.id, line: i };
    delete out.splits;
    delete out.orig;
    delete out.debt;
    if (l.sub) out.sub = l.sub; else delete out.sub;
    const note = [t.note, l.note].map((x) => String(x || '').trim()).filter(Boolean).join(' · ');
    if (note) out.note = note; else delete out.note;
    if (l.incomeSource) out.incomeSource = l.incomeSource; // an income line's own source (js/incomesources.js)
    return out;
  });
}

/** A list with every split record replaced by its lines. The same array back when nothing is split. */
export function expandSplits(list) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.some((t) => t && t.splits)) return arr;
  const out = [];
  for (const t of arr) {
    if (t && t.splits) out.push(...splitLines(t));
    else out.push(t);
  }
  return out;
}

/** Every record of the state as lines: what totals count. */
export const linesOf = (state) => expandSplits(state?.tx || []);

/**
 * Checks lines typed in the form against the total. `lines`: [{ amount (cents
 * or null), category }]. Returns { ok, left, used, error }: `left` is what is
 * still to share (negative = too much).
 */
export function checkSplit(total, lines) {
  const list = Array.isArray(lines) ? lines : [];
  const used = list.reduce((a, l) => a + (Number.isSafeInteger(l?.amount) && l.amount > 0 ? l.amount : 0), 0);
  const left = total - used;
  let error = '';
  if (list.length < 2) error = 'Add at least two lines';
  else if (list.some((l) => !(Number.isSafeInteger(l?.amount) && l.amount > 0))) error = 'Each line needs an amount above 0';
  else if (list.some((l) => !l?.category)) error = 'Pick a category for each line';
  else if (left > 0) error = 'left';
  else if (left < 0) error = 'over';
  return { ok: !error, left, used, error };
}

/** Clean lines to store: only the known keys, empty ones dropped. */
export function cleanLines(lines) {
  return (lines || []).map((l) => {
    const out = {};
    for (const k of LINE_KEYS) {
      const v = l?.[k];
      if (v == null || v === '') continue;
      out[k] = typeof v === 'string' ? v.trim() : v;
      if (out[k] === '') delete out[k];
    }
    return out;
  });
}

/**
 * The record with these lines (a new object; null when they do not fit). The
 * record's own category becomes the first line's, so a reader that does not
 * know lines still sees a real category; its subcategory goes (lines may
 * carry their own).
 */
export function withSplits(t, lines) {
  if (!canSplit(t)) return null;
  const clean = cleanLines(lines);
  if (!checkSplit(t.amount, clean).ok) return null;
  const out = { ...t, splits: clean, category: clean[0].category };
  delete out.sub;
  return out;
}

/** Back to one line: the lines go, the record keeps the first line's category. */
export function unsplit(t) {
  const out = { ...t };
  const first = Array.isArray(t.splits) && t.splits[0];
  if (first?.category) out.category = first.category;
  delete out.splits;
  return out;
}

/** "Food 400 · Home 200" (names and money from the caller). */
export function splitText(t, catName = (id) => id, fmt = (c) => String(c / 100)) {
  const lines = Array.isArray(t?.splits) ? t.splits : [];
  return lines.map((l) => `${catName(l.category)} ${fmt(l.amount, t.currency)}`).join(' · ');
}
