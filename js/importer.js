// Brings data in from the Google Sheet you used before (one month tab exported
// as CSV) or from this app's own CSV export.

import { parseAmount, centsToPlain } from './money.js';
import { parseLooseDate } from './dates.js';
import { suggestCategory, uid, ensurePerson, B } from './model.js';
import { pairRate } from './fx.js';

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
export function detectColumns(rows) {
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
  // For the import check: what was already here, and rows with an amount
  // that couldn't be imported (no date).
  const dup = { income: 0, expense: 0 };
  const skippedRows = [];
  let base = Date.now();

  const baseCur = state.settings.currency;
  const accCur = (id) => state.settings.accounts.find((a) => a.id === id)?.currency || baseCur;
  const allMonths = new Set();
  const add = (t) => {
    allMonths.add(t.date.slice(0, 7));
    const key = txKey(t);
    if (existing.get(key) > 0) {
      existing.set(key, existing.get(key) - 1);
      duplicates++;
      if (dup[t.type] != null) dup[t.type] += t.amount;
      return;
    }
    const currency = t.currency || accCur(t.account || t.from);
    const rate = currency === baseCur ? 1 : pairRate(currency, baseCur, state.rates);
    const stamp = base++;
    out.push({ id: uid(), createdAt: stamp, updatedAt: stamp, ...t, currency, rate, base: rate ? Math.round(t.amount * rate) : t.amount });
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
      const cur = String(cell(row, c.currency ?? -1)).trim().toUpperCase();
      const currency = /^[A-Z]{3,5}$/.test(cur) ? cur : undefined;
      if (type === 'transfer') {
        const from = findAcc(cell(row, c.from ?? -1));
        const to = findAcc(cell(row, c.to ?? -1));
        if (!from || !to || from === to) { skipped++; continue; }
        add({ type, amount, date, from, to, note, ...(currency ? { currency } : {}) });
      } else {
        const cat = findCat(cell(row, c.category ?? -1), type)
          || suggestCategory(state, note, type) || (type === 'income' ? 'other-in' : 'other');
        const acc = findAcc(cell(row, c.account ?? -1)) || defaultAccount;
        const who = String(cell(row, c.person ?? -1)).trim();
        const personId = who ? ensurePerson(state, who) : null;
        const loan = /^(yes|da|true|1|loan)$/i.test(String(cell(row, c.loan ?? -1)).trim());
        add({ type, amount, date, category: cat, account: acc, note, ...(currency ? { currency } : {}), ...(personId ? { person: personId } : {}), ...(personId && loan ? { loan: true } : {}) });
      }
      continue;
    }

    const date = parseLooseDate(cell(row, cols.date));
    const earned = parseAmount(cell(row, cols.earned));
    const spent = parseAmount(cell(row, cols.spent));
    if (!date) {
      skipped++;
      if (earned > 0 || spent > 0) skippedRows.push({ row: r + 1, label: String(cell(row, cols.date) || '').trim(), earned: Math.max(0, earned || 0), spent: Math.max(0, spent || 0) });
      continue;
    }
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
  return { format: cols.format, tx: out, duplicates, skipped, income, expense, months, allMonths: [...allMonths].sort(), dup, skippedRows, stated: cols.format === 'sheet' ? statedTotals(rows) : null };
}

// Totals your sheet states itself, from cells labelled e.g. "PROFIT (this
// month)" / "SPENT (this month)" (the value is the cell below). Null when
// there are none or they're empty (formulas not calculated).
export function statedTotals(rows) {
  const find = (re) => {
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (!re.test(norm(rows[r][c]))) continue;
        const v = parseAmount(rows[r + 1]?.[c]);
        if (v > 0) return v;
      }
    }
    return null;
  };
  const earned = find(/^(profit|earned|income|venit|castig)\b.*(month|luna|total)/);
  const spent = find(/^(spent|cheltuit|cheltuieli|expenses)\b.*(month|luna|total)/);
  return earned == null && spent == null ? null : { earned, spent };
}

// After an import: does what's in the app now match the sheet? Per tab:
// the sheet's own totals (stated cells, a total row at the bottom, or the
// columns added up) against the records from it now in the app (new and
// already there), with the rows that explain any difference.
export function importCheck(results) {
  return results.filter((t) => t.tx.length || t.duplicates).map((t) => {
    const app = { earned: t.income + (t.dup?.income || 0), spent: t.expense + (t.dup?.expense || 0) };
    let rows = t.skippedRows || [];
    // A row without a date whose amount is the column's total is a total row.
    const totalRow = (k) => rows.find((x) => x[k] > 0 && x[k] === app[k]);
    const sheet = {};
    const source = {};
    for (const k of ['earned', 'spent']) {
      if (t.stated?.[k] != null) { sheet[k] = t.stated[k]; source[k] = 'stated'; }
      else if (totalRow(k)) { sheet[k] = app[k]; source[k] = 'total row'; }
      else { sheet[k] = app[k] + rows.reduce((a, x) => a + x[k], 0); source[k] = 'columns'; }
    }
    rows = rows.filter((x) => !(x.earned && x.earned === app.earned && source.earned === 'total row') && !(x.spent && x.spent === app.spent && source.spent === 'total row'));
    const diff = { earned: sheet.earned - app.earned, spent: sheet.spent - app.spent };
    return { name: t.name || '', months: t.allMonths || t.months, sheet, app, source, diff, ok: !diff.earned && !diff.spent, skippedRows: rows, duplicates: t.duplicates || 0, added: t.tx.length };
  });
}

// A whole workbook (every tab): each tab is imported on its own, so you can
// see per month what will come in and leave tabs out (e.g. an overview).
export function importWorkbook(sheets, state, opts = {}) {
  const out = [];
  for (const sh of sheets) {
    const rows = sh.rows.filter((r) => r && r.some((c) => String(c ?? '').trim() !== ''));
    if (!rows.length) { out.push({ name: sh.name, tx: [], income: 0, expense: 0, months: [], duplicates: 0 }); continue; }
    out.push({ name: sh.name, ...importRows(rows.map((r) => r.map((c) => (c === true ? 'yes' : c === false ? '' : c))), state, opts) });
  }
  return { sheets: out };
}

export const EXPORT_HEADER = ['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'From', 'To', 'Note', 'Person', 'Loan'];

// Rows as people read them (names, not ids), oldest first. Used for the CSV
// export and for "Copy table", and the importer reads them back.
export function exportRows(state, list = state.tx) {
  const catName = (id) => state.settings.categories.find((c) => c.id === id)?.name || '';
  const accName = (id) => state.settings.accounts.find((a) => a.id === id)?.name || '';
  const rows = [EXPORT_HEADER];
  const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  for (const t of sorted) {
    rows.push([t.date, TYPE_LABEL[t.type], centsToPlain(t.amount), t.currency || state.settings.currency, catName(t.category),
      accName(t.account), accName(t.from), accName(t.to), t.note || '',
      state.people.find((p) => p.id === t.person)?.name || '', t.loan ? 'yes' : '']);
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
  const who = (id) => state.people.find((p) => p.id === id)?.name || '';
  const baseCur = state.settings.currency;
  const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  // Loans get their own type so the Earned/Spent totals leave them out.
  const typeOf = (t) => (t.loan ? (t.type === 'expense' ? 'Lent' : 'Borrowed') : TYPE_LABEL[t.type]);
  const rows = [['Date', 'Type', 'Category', 'Note', 'Who', 'Account', 'Amount', 'Currency', `In ${baseCur}`]];
  for (const t of sorted) {
    rows.push([{ v: t.date, t: 'date' }, typeOf(t), t.type === 'transfer' ? '' : catName(t.category), t.note || '', who(t.person),
      t.type === 'transfer' ? `${accName(t.from)} → ${accName(t.to)}` : accName(t.account),
      { v: t.amount / 100, t: 'money' }, t.currency || baseCur, { v: B(t) / 100, t: 'money' }]);
  }
  const n = sorted.length;
  const sum = (type) => sorted.filter((t) => t.type === type && !t.loan).reduce((a, t) => a + B(t), 0) / 100;
  const range = (col) => `${col}2:${col}${n + 1}`;
  const earnedRow = n + 3;
  const label = (v) => ['', '', '', '', '', '', '', { v, bold: true }];
  rows.push([]);
  rows.push([...label('Earned'), { f: `SUMIF(${range('B')},"Earned",${range('I')})`, v: sum('income'), t: 'money', bold: true }]);
  rows.push([...label('Spent'), { f: `SUMIF(${range('B')},"Spent",${range('I')})`, v: sum('expense'), t: 'money', bold: true }]);
  rows.push([...label('Kept'), { f: `I${earnedRow}-I${earnedRow + 1}`, v: sum('income') - sum('expense'), t: 'money', bold: true }]);
  return { cols: [13, 10, 20, 30, 14, 18, 13, 9, 14], rows, filterRows: n };
}

// The "Overview" tab: earned / spent / kept for every month of a year.
export function overviewSheet(state, year) {
  const rows = [['Month', 'Earned', 'Spent', 'Kept', 'Kept %']];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  months.forEach((m, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const list = state.tx.filter((t) => t.date.startsWith(key));
    const inc = list.filter((t) => t.type === 'income' && !t.loan).reduce((a, t) => a + B(t), 0);
    const exp = list.filter((t) => t.type === 'expense' && !t.loan).reduce((a, t) => a + B(t), 0);
    const r = i + 2;
    rows.push([m, { v: inc / 100, t: 'money' }, { v: exp / 100, t: 'money' }, { f: `B${r}-C${r}`, v: (inc - exp) / 100, t: 'money' },
      inc ? `${Math.round(((inc - exp) / inc) * 100)}%` : '']);
  });
  const total = (col) => ({ f: `SUM(${col}2:${col}13)`, t: 'money', bold: true });
  rows.push([{ v: 'Total', bold: true }, total('B'), total('C'), total('D'), '']);
  return { cols: [14, 14, 14, 14, 9], rows };
}
