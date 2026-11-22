// Your Money as a Google Sheet that keeps itself up to date: the server gives
// two private links (api/calendar.mjs ?s=…&t=records|months) and a sheet cell
// =IMPORTDATA("link") pulls them (Google refreshes about every hour). No Google
// sign-in, nothing to set up in Google Cloud. Pure and tested (tests/sheetfeed.test.js).

import { category, account, monthSummary, personalMonth } from './model.js';
import { addMonths, monthKey } from './dates.js';

const cell = (v) => {
  const s = String(v ?? '');
  // A leading = + - @ would be read as a formula by the sheet: keep it plain text.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const row = (cells) => cells.map(cell).join(',');
const num = (cents) => (Math.round(cents) / 100).toFixed(2);

/** Every record, newest first: Date, Type, Amount, Currency, Account, To account, Category, Note. */
export function recordsCSV(state) {
  const name = (id) => (id ? account(state, id)?.name || id : '');
  const list = [...(state.tx || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  const lines = [row(['Date', 'Type', 'Amount', 'Currency', 'Account', 'To account', 'Category', 'Note'])];
  for (const t of list) {
    const from = t.type === 'transfer' ? name(t.from || t.account) : name(t.account);
    const to = t.type === 'transfer' ? name(t.to) : '';
    const cat = t.type === 'transfer' ? '' : category(state, t.category)?.name || '';
    lines.push(row([t.date, t.type, num(t.amount || 0), t.currency || state.settings.currency || 'MDL', from, to, cat, t.note || '']));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** One line per month (last 24, newest first): Month, Income, Spent, Kept, then your side of it. */
export function monthsCSV(state, today, months = 24) {
  const lines = [row(['Month', 'Income', 'Spent', 'Kept', 'Your income', 'Your spending', 'You kept', 'Currency'])];
  const cur = state.settings.currency || 'MDL';
  const first = (state.tx || []).reduce((m, t) => (t.date && (!m || t.date < m) ? t.date : m), '');
  for (let i = 0; i < months; i++) {
    const key = addMonths(monthKey(today), -i);
    if (!first || key < first.slice(0, 7)) break;
    const s = monthSummary(state, key);
    const p = personalMonth(state, key);
    lines.push(row([key, num(s.income), num(s.expense), num(s.net), num(p.personalIncome), num(p.personalSpent), num(p.kept), cur]));
  }
  return `${lines.join('\r\n')}\r\n`;
}
