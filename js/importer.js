// Brings data in from the Google Sheet you used before (one month tab exported
// as CSV) or from this app's own CSV export.

import { parseAmount } from './money.js';
import { parseLooseDate } from './dates.js';
import { suggestCategory, uid } from './model.js';

const norm = (s) => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

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
  const catIds = new Set(state.settings.categories.map((c) => c.id));
  const accIds = new Set(state.settings.accounts.map((a) => a.id));
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
      const type = norm(cell(row, c.type));
      const amount = Math.abs(parseAmount(cell(row, c.amount)) || 0);
      if (!date || !amount || !['income', 'expense', 'transfer'].includes(type)) { skipped++; continue; }
      const note = String(cell(row, c.note ?? -1)).trim();
      if (type === 'transfer') {
        const from = String(cell(row, c.from ?? -1)).trim();
        const to = String(cell(row, c.to ?? -1)).trim();
        if (!accIds.has(from) || !accIds.has(to) || from === to) { skipped++; continue; }
        add({ type, amount, date, from, to, note });
      } else {
        let cat = String(cell(row, c.category ?? -1)).trim();
        if (!catIds.has(cat)) cat = suggestCategory(state, note, type) || (type === 'income' ? 'other-in' : 'other');
        let acc = String(cell(row, c.account ?? -1)).trim();
        if (!accIds.has(acc)) acc = defaultAccount;
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

export function exportRows(state) {
  const rows = [EXPORT_HEADER];
  const sorted = [...state.tx].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  for (const t of sorted) {
    rows.push([t.date, t.type, (t.amount / 100).toFixed(2), state.settings.currency, t.category || '',
      t.account || '', t.from || '', t.to || '', t.note || '']);
  }
  return rows;
}
