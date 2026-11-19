// Spreadsheet-style keys for the Log's Sheet and Table (the DOM side is
// js/gridedit.js). Pure: key events and positions in, what to do out, so the
// rules are tested without a page.
//
// A grid is `rows` x `cols` cells. A position is { r, c } (0-based). A cell is
// either selected ("nav" mode: arrows move, typing replaces) or being edited
// ("edit" mode: the box has the focus and the keys are the box's).

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Arrow keys (Ctrl jumps to the edge). */
export function moveCell(pos, key, { rows, cols, jump = false }) {
  let { r, c } = pos;
  if (key === 'ArrowUp') r = jump ? 0 : r - 1;
  else if (key === 'ArrowDown') r = jump ? rows - 1 : r + 1;
  else if (key === 'ArrowLeft') c = jump ? 0 : c - 1;
  else if (key === 'ArrowRight') c = jump ? cols - 1 : c + 1;
  else if (key === 'Home') c = 0;
  else if (key === 'End') c = cols - 1;
  return { r: clamp(r, 0, rows - 1), c: clamp(c, 0, cols - 1) };
}

/** Tab / Shift+Tab: across, then on to the next (previous) row. Stops at the ends. */
export function tabCell(pos, back, { rows, cols }) {
  let { r, c } = pos;
  if (back) { c -= 1; if (c < 0) { r -= 1; c = cols - 1; } } else { c += 1; if (c >= cols) { r += 1; c = 0; } }
  if (r < 0 || r >= rows) return { r: pos.r, c: pos.c, edge: true };
  return { r, c, edge: false };
}

/** The rectangle between two positions. */
export function rectOf(a, b) {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}
export const inRect = (rect, r, c) => r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
export const rectSize = (rect) => ({ rows: rect.r2 - rect.r1 + 1, cols: rect.c2 - rect.c1 + 1 });
export const isSingle = (rect) => rect.r1 === rect.r2 && rect.c1 === rect.c2;

/**
 * What a key press means. `k`: { key, ctrl, shift, alt, meta }. `mode`: 'nav' | 'edit'.
 * Returns null when it is not ours (the page or the box handles it).
 */
export function keyIntent(k, mode) {
  const ctrl = !!(k.ctrl || k.meta);
  if (k.alt) return null;
  if (mode === 'edit') {
    if (k.key === 'Escape') return { type: 'cancel' };
    if (k.key === 'Enter') return { type: 'commit', dir: k.shift ? 'up' : 'down' };
    if (k.key === 'Tab') return { type: 'commit', dir: k.shift ? 'left' : 'right' };
    return null;
  }
  if (/^Arrow/.test(k.key) || k.key === 'Home' || k.key === 'End') return { type: 'move', key: k.key, extend: !!k.shift, jump: ctrl };
  if (k.key === 'Tab') return { type: 'tab', back: !!k.shift };
  if (k.key === 'Enter') return k.shift ? { type: 'move', key: 'ArrowUp', extend: false, jump: false } : { type: 'edit' };
  if (k.key === 'F2') return { type: 'edit' };
  if (k.key === 'Escape') return { type: 'escape' };
  if (k.key === 'Delete' || k.key === 'Backspace') return k.shift && k.key === 'Delete' ? { type: 'delete-record' } : { type: 'clear' };
  if (ctrl) {
    const l = String(k.key).toLowerCase();
    if (l === 'd') return { type: 'fill-down' };
    if (l === 'a') return { type: 'select-all' };
    return null; // Ctrl+C / X / V come as clipboard events; Ctrl+Z / Y are the record undo
  }
  if (String(k.key).length === 1 && k.key !== ' ') return { type: 'type', char: k.key };
  return null;
}

// ---------- Clipboard ----------

/** Text from a spreadsheet (tabs between cells, a line per row; quoted cells may hold tabs and new lines). */
export function parseClipboard(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** A matrix as text for the clipboard (what Excel and Google Sheets paste). */
export function formatClipboard(matrix) {
  const q = (v) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return matrix.map((row) => row.map((v) => q(String(v ?? ''))).join('\t')).join('\n');
}

/**
 * Where pasted cells go. `rect`: the selection; `matrix`: the pasted values;
 * `dims`: { rows, cols }. One value into a range fills the range; otherwise the
 * block starts at the selection's top left and is cut at the grid's edge.
 * Returns { cells: [{ r, c, value }], cut } (`cut`: how many values did not fit).
 */
export function pasteTargets(rect, matrix, dims) {
  const out = [];
  let cut = 0;
  const one = matrix.length === 1 && matrix[0].length === 1;
  if (one && !isSingle(rect)) {
    for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) out.push({ r, c, value: matrix[0][0] });
    return { cells: out, cut };
  }
  matrix.forEach((line, i) => line.forEach((value, j) => {
    const r = rect.r1 + i;
    const c = rect.c1 + j;
    if (r >= dims.rows || c >= dims.cols) cut++;
    else out.push({ r, c, value });
  }));
  return { cells: out, cut };
}

/** Ctrl+D: each column of the selection takes its top cell's value down (one row selected: the cell above). */
export function fillPlan(rect) {
  const out = [];
  const single = rect.r1 === rect.r2;
  if (single && rect.r1 === 0) return out;
  for (let c = rect.c1; c <= rect.c2; c++) {
    const from = single ? rect.r1 - 1 : rect.r1;
    for (let r = single ? rect.r1 : rect.r1 + 1; r <= rect.r2; r++) out.push({ from: { r: from, c }, to: { r, c } });
  }
  return out;
}

// ---------- Cell values ----------

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const stripEmoji = (s) => String(s ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

/** Amounts from a sheet: "1 200,50 MDL", "$12.5" -> "1200,50", "12.5" (what the amount box takes). */
export function cleanAmountText(text) {
  const t = String(text ?? '').replace(/[ \s]/g, '').replace(/[^\d.,+\-*/()]/g, '');
  return t;
}

/** "2026-11-05", "5.11.2026", "5/11/2026" (day first) -> "2026-11-05", else null. */
export function parseDateCell(text) {
  const t = String(text ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y; let mo; let d;
  if (m) [, y, mo, d] = m;
  else if ((m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) [, d, mo, y] = m;
  else return null;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The option a pasted or typed text means: value, name, name without its icon, then the start of a name. */
export function matchOption(options, text) {
  const t = fold(text);
  if (!t) return null;
  const by = (f) => options.find((o) => f(o));
  return by((o) => fold(o.value) === t) || by((o) => fold(o.label) === t) || by((o) => fold(stripEmoji(o.label)) === t)
    || by((o) => fold(stripEmoji(o.label)).startsWith(t)) || null;
}

/** For the dropdown: options whose name contains the typed text, names that start with it first. */
export function filterOptions(options, q) {
  const t = fold(q);
  if (!t) return options.slice();
  const name = (o) => fold(stripEmoji(o.label));
  const starts = options.filter((o) => name(o).startsWith(t));
  const has = options.filter((o) => !name(o).startsWith(t) && (name(o).includes(t) || fold(o.value) === t));
  return [...starts, ...has];
}
