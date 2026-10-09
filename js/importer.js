// Brings data in from the Google Sheet you used before (one month tab exported
// as CSV) or from this app's own CSV export.

import { parseAmount, centsToPlain } from './money.js';
import { parseLooseDate } from './dates.js';
import { suggestCategory, uid } from './model.js';

const norm = (s) => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const TYPE_WORDS = {
  income: 'income', earned: 'income', venit: 'income', доход: 'income',
  expense: 'expense', spent: 'expense', cheltuiala: 'expense', расход: 'expense',
  transfer: 'transfer', move: 'transfer', moved: 'transfer', mutare: 'transfer', перевод: 'transfer',
};
export const TYPE_LABEL = { income: 'Earned', expense: 'Spent', transfer: 'Move' };

export const txKey = (t) => [t.date, t.type, t.amount, (t.note || '').trim().toLowerCase(), t.account || t.from || ''].join('|');

// Works out which column holds what. Google Sheets exports the whole tab, so
// the header row may sit among other blocks (calculator, goal, etc.).
function detectColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const h = rows[r].map(norm);
    if (h.includes('type') && h.includes('amount') && h.includes('date')) {
      return { format: 'app', headerRow: r, col: Object.fromEntries(h.map((v, i) => [v, i])) };
    }
    const date = h.findIndex((v) => /^(date|data|дата|day|zi)$/.test(v));
    const earned = h.findIndex((v) => /earn|income|venit|castig|primit|доход/.test(v));
    const spent = h.findIndex((v) => /invest|spent|expense|cheltu|расход|cost/.test(v));
    if (date >= 0 && (earned >= 0 || spent >= 0)) {
      const descAfter = (i) => (i >= 0 && /desc|note|notit|comment|опис|what/.test(h[i + 1] || '') ? i + 1 : -1);
      return { format: 'sheet', headerRow: r, date, earned, spent, earnedNote: descAfter(earned), spentNote: descAfter(spent) };
    }
  }
  // No header: assume the original layout A=Date B=Earned C=Description D=Spent E=Description2.
  return { format: 'sheet', headerRow: -1, date: 0, earned: 1, earnedNote: 2, spent: 3, spentNote: 4 };
}

export function importRows(rows, state, { account } = {}) {
  const cols = detectColumns(rows);
  // Multiset, so importing the same file twice adds nothing, while two identical
  // rows in one file (two bus tickets on the same day) both count.
  const existing = new Map();
  for (const t of state.tx) existing.set(txKey(t), (existing.get(txKey(t)) || 0) + 1);
  const defaultAccount = account || state.settings.accounts[0]?.id || 'wallet';
  // Category and account cells may hold an id ("food") or the name you see
  // in the app ("Food"), so tables copied out of the app paste back in.
  const findCat = (text, type) => {
    const t = norm(text);
    return state.settings.categories.find((c) => c.type === type && (norm(c.id) === t || norm(c.name) === t))?.id;
  };
  const findAcc = (text) => {
    const t = norm(text);
    return state.settings.accounts.find((a) => norm(a.id) === t || norm(a.name) === t)?.id;
  };
  const out = [];
  let duplicates = 0;
  let skipped = 0;
  let base = Date.now();

  const add = (t) => {
    const key = txKey(t);
    if (existing.get(key) > 0) { existing.set(key, existing.get(key) - 1); duplicates++; return; }
    out.push({ id: uid(), createdAt: base++, ...t });
  };

  const cell = (row, i) => (i >= 0 && i < row.length ? row[i] : '');

  for (let r = cols.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !String(c).trim())) continue;

    if (cols.format === 'app') {
      const c = cols.col;
      const date = parseLooseDate(cell(row, c.date));
      const type = TYPE_WORDS[norm(cell(row, c.type))];
      const amount = Math.abs(parseAmount(cell(row, c.amount)) || 0);
      if (!date || !amount || !type) { skipped++; continue; }
      const note = String(cell(row, c.note ?? -1)).trim();
      if (type === 'transfer') {
        const from = findAcc(cell(row, c.from ?? -1));
        const to = findAcc(cell(row, c.to ?? -1));
        if (!from || !to || from === to) { skipped++; continue; }
        add({ type, amount, date, from, to, note });
      } else {
        const cat = findCat(cell(row, c.category ?? -1), type)
          || suggestCategory(state, note, type) || (type === 'income' ? 'other-in' : 'other');
        const acc = findAcc(cell(row, c.account ?? -1)) || defaultAccount;
        add({ type, amount, date, category: cat, account: acc, note });
      }
      continue;
    }

    const date = parseLooseDate(cell(row, cols.date));
    if (!date) { skipped++; continue; }
    const earned = parseAmount(cell(row, cols.earned));
    const spent = parseAmount(cell(row, cols.spent));
    if (earned > 0) {
      const note = String(cell(row, cols.earnedNote)).trim();
      add({ type: 'income', amount: earned, date, note, account: defaultAccount, category: suggestCategory(state, note, 'income') || 'other-in' });
    }
    if (spent > 0) {
      const note = String(cell(row, cols.spentNote)).trim();
      add({ type: 'expense', amount: spent, date, note, account: defaultAccount, category: suggestCategory(state, note, 'expense') || 'other' });
    }
  }

  const income = out.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const expense = out.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const months = [...new Set(out.map((t) => t.date.slice(0, 7)))].sort();
  return { format: cols.format, tx: out, duplicates, skipped, income, expense, months };
}

export const EXPORT_HEADER = ['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'From', 'To', 'Note'];

// Rows as people read them (names, not ids), oldest first. Used for the CSV
// export and for "Copy table", and the importer reads them back.
export function exportRows(state, list = state.tx) {
  const catName = (id) => state.settings.categories.find((c) => c.id === id)?.name || '';
  const accName = (id) => state.settings.accounts.find((a) => a.id === id)?.name || '';
  const rows = [EXPORT_HEADER];
  const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  for (const t of sorted) {
    rows.push([t.date, TYPE_LABEL[t.type], centsToPlain(t.amount), state.settings.currency, catName(t.category),
      accName(t.account), accName(t.from), accName(t.to), t.note || '']);
  }
  return rows;
}

export function toTSV(rows) {
  return rows.map((r) => r.map((v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

// ---------- Excel workbook contents (see xlsx.js for the file format) ----------

// One month as an Excel sheet: the records, then totals as live formulas.
export function monthSheet(state, key, list = state.tx.filter((t) => t.date.startsWith(key))) {
  const catName = (id) => state.settings.categories.find((c) => c.id === id)?.name || '';
  const accName = (id) => state.settings.accounts.find((a) => a.id === id)?.name || '';
  const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  const rows = [['Date', 'Type', 'Category', 'Note', 'Account', `Amount (${state.settings.currency})`]];
  for (const t of sorted) {
    rows.push([{ v: t.date, t: 'date' }, TYPE_LABEL[t.type], t.type === 'transfer' ? '' : catName(t.category), t.note || '',
      t.type === 'transfer' ? `${accName(t.from)} → ${accName(t.to)}` : accName(t.account), { v: t.amount / 100, t: 'money' }]);
  }
  const n = sorted.length;
  const sum = (type) => sorted.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0) / 100;
  const range = (col) => `${col}2:${col}${n + 1}`;
  const earnedRow = n + 3;
  rows.push([]);
  rows.push(['', '', '', '', { v: 'Earned', bold: true }, { f: `SUMIF(${range('B')},"Earned",${range('F')})`, v: sum('income'), t: 'money', bold: true }]);
  rows.push(['', '', '', '', { v: 'Spent', bold: true }, { f: `SUMIF(${range('B')},"Spent",${range('F')})`, v: sum('expense'), t: 'money', bold: true }]);
  rows.push(['', '', '', '', { v: 'Kept', bold: true }, { f: `F${earnedRow}-F${earnedRow + 1}`, v: sum('income') - sum('expense'), t: 'money', bold: true }]);
  return { cols: [13, 9, 22, 34, 18, 16], rows, filterRows: n };
}

// The "Overview" tab: earned / spent / kept for every month of a year.
export function overviewSheet(state, year) {
  const rows = [['Month', 'Earned', 'Spent', 'Kept', 'Kept %']];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  months.forEach((m, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const list = state.tx.filter((t) => t.date.startsWith(key));
    const inc = list.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
    const exp = list.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    const r = i + 2;
    rows.push([m, { v: inc / 100, t: 'money' }, { v: exp / 100, t: 'money' }, { f: `B${r}-C${r}`, v: (inc - exp) / 100, t: 'money' },
      inc ? `${Math.round(((inc - exp) / inc) * 100)}%` : '']);
  });
  const total = (col) => ({ f: `SUM(${col}2:${col}13)`, t: 'money', bold: true });
  rows.push([{ v: 'Total', bold: true }, total('B'), total('C'), total('D'), '']);
  return { cols: [14, 14, 14, 14, 9], rows };
}
