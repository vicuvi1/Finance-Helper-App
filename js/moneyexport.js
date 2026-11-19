// The full money export, and its import back (a round trip).
//
// Export: every transaction with every field (date, account, category,
// amount, currency, its value in the main currency, the rate, note, tags,
// person / client, invoice id, `repricedFrom`, ids and anything else a record
// carries, in "Other fields" as JSON so nothing is lost), plus accounts,
// invoices, clients, recurring items, goals and reconciliation points.
// CSV is UTF-8 with a BOM (Excel then reads letters and emoji right); the
// workbook (xlsx.js) has one sheet per table.
//
// Import: reads that same transactions CSV back. It never changes or deletes
// a record that is already here: a row whose id is here (or was deleted
// here), or that matches a record here on date, type, amount, note and
// account, is a duplicate and is skipped. Each new row keeps its id, its
// rate and its value in the main currency exactly as exported. Pure; tested.

import { txKey } from './importer.js';
import { tagsOf, uid } from './model.js';
import { parseAmount } from './money.js';
import { isValidISO } from './dates.js';
import { describe } from './recurring.js';
import { exportDefs, columnName, cellOf, valueOf, readImportFields } from './fields.js';

export const TX_HEADER = ['ID', 'Date', 'Type', 'Account', 'From', 'To', 'To amount', 'Category', 'Subcategory', 'Amount', 'Currency', 'Base amount', 'Base currency', 'Rate',
  'Note', 'Tags', 'Person', 'Client', 'Invoice ID', 'Loan', 'Repriced from', 'Recurring ID', 'Reconciliation ID', 'Created', 'Updated',
  'Account ID', 'From ID', 'To ID', 'Category ID', 'Subcategory ID', 'Person ID', 'Other fields'];

// Fields with their own column; everything else goes to "Other fields".
const OWN = new Set(['id', 'date', 'type', 'account', 'from', 'to', 'toAmount', 'category', 'sub', 'amount', 'currency', 'base', 'rate', 'note', 'person', 'invoice', 'loan', 'repricedFrom', 'recurring', 'reconcile', 'createdAt', 'updatedAt']);

// 1234 bani -> "12.34" (always two decimals, a dot, no grouping).
export const plain = (c) => (Number.isInteger(c) ? `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}` : '');
const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '');
const json = (v) => (v == null ? '' : JSON.stringify(v));

// "12.34" -> 1234 exactly; also "12,34" or "1 234,50" from a spreadsheet saved
// in another locale. null when there is no number.
export function cents(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^-?\d+(\.\d{1,2})?$/.test(s)) {
    const neg = s.startsWith('-');
    const [i, f = ''] = s.replace('-', '').split('.');
    const v = Number(i) * 100 + Number(f.padEnd(2, '0'));
    return neg ? -v : v;
  }
  return parseAmount(s);
}

const TYPE_OUT = { income: 'income', expense: 'expense', transfer: 'transfer' };

function names(state) {
  const acc = new Map(state.settings.accounts.map((a) => [a.id, a.name]));
  const cat = new Map(state.settings.categories.map((c) => [c.id, c.name]));
  const sub = new Map((state.settings.subcats || []).map((c) => [c.id, c.name]));
  const ppl = new Map((state.people || []).map((p) => [p.id, p]));
  return { acc: (id) => (id ? acc.get(id) ?? '' : ''), cat: (id) => (id ? cat.get(id) ?? '' : ''), sub: (id) => (id ? sub.get(id) ?? '' : ''), person: (id) => (id ? ppl.get(id) : null) };
}

// One row per record, oldest first (same day: in the order they were added).
export function txRows(state, list = state.tx) {
  const n = names(state);
  const baseCur = state.settings.currency;
  const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  // Your own fields (js/fields.js) get a readable column each, "Field: Project", after the
  // fixed ones; the values also stay in "Other fields", so the round trip loses nothing.
  const defs = exportDefs(state, list);
  const rows = [defs.length ? [...TX_HEADER, ...defs.map(columnName)] : TX_HEADER];
  for (const t of sorted) {
    const other = {};
    for (const k of Object.keys(t)) if (!OWN.has(k) && t[k] !== undefined) other[k] = t[k];
    const p = n.person(t.person);
    rows.push([
      t.id, t.date, TYPE_OUT[t.type] || t.type, n.acc(t.account), n.acc(t.from), n.acc(t.to), plain(t.toAmount), n.cat(t.category), n.sub(t.sub),
      plain(t.amount), t.currency || baseCur, plain(Number.isInteger(t.base) ? t.base : null), baseCur, t.rate == null ? '' : String(t.rate),
      t.note || '', tagsOf(t.note || '').join(' '), p?.name || '', p?.client ? p.name : '', t.invoice || '', t.loan ? 'yes' : '', json(t.repricedFrom),
      t.recurring || '', t.reconcile || '', iso(t.createdAt), iso(t.updatedAt),
      t.account || '', t.from || '', t.to || '', t.category || '', t.sub || '', t.person || '', Object.keys(other).length ? JSON.stringify(other) : '',
      ...defs.map((d) => cellOf(d, valueOf(t, d.id))),
    ]);
  }
  return rows;
}

// The other tables, as rows (header first).
export function accountRows(state) {
  const rows = [['ID', 'Name', 'Kind', 'Bank', 'Currency', 'Start balance', 'Last 4', 'Savings', 'Archived', 'Coins', 'Updated']];
  for (const a of state.settings.accounts) rows.push([a.id, a.name, a.kind || '', a.bank || '', a.currency || state.settings.currency, plain(a.start || 0), a.last4 || '', a.savings ? 'yes' : '', a.archived ? 'yes' : '', json((a.holdings || []).length ? a.holdings : null), iso(a.updatedAt)]);
  return rows;
}
export function invoiceRows(state) {
  const n = names(state);
  const rows = [['ID', 'Number', 'Client', 'Date', 'Due', 'Currency', 'Items', 'Sent', 'Paid on', 'Payment record ID', 'Note', 'Updated']];
  for (const i of state.invoices || []) rows.push([i.id, i.number || '', n.person(i.client)?.name || '', i.date, i.due || '', i.currency || '', json(i.items || []), i.sent ? 'yes' : '', i.paidDate || '', i.paidTx || '', i.note || '', iso(i.updatedAt)]);
  return rows;
}
export function clientRows(state) {
  const rows = [['ID', 'Name', 'Group', 'Currency', 'Hourly rate', 'Note', 'Updated']];
  for (const p of (state.people || []).filter((x) => x.client)) rows.push([p.id, p.name, p.group || '', p.currency || '', p.rate == null ? '' : plain(p.rate), p.note || '', iso(p.updatedAt)]);
  return rows;
}
export function recurringRows(state) {
  const n = names(state);
  const rows = [['ID', 'Type', 'Note', 'Amount', 'Currency', 'Every', 'Start', 'End', 'Account', 'Category', 'Person', 'Paused', 'Auto', 'Last done', 'Updated']];
  for (const r of state.recurring || []) rows.push([r.id, r.type, r.note || '', plain(r.amount), r.currency || state.settings.currency, r.every === 'custom' ? describe(r) : r.every, r.start, r.end || '', n.acc(r.account), n.cat(r.category), n.person(r.person)?.name || '', r.paused ? 'yes' : '', r.auto ? 'yes' : '', r.lastDone || '', iso(r.updatedAt)]);
  return rows;
}
export function goalRows(state) {
  const rows = [['ID', 'Name', 'Target', 'Saved', 'Account', 'Deadline', 'Done on', 'Archived', 'Updated']];
  for (const g of state.goals || []) rows.push([g.id, g.name, plain(g.target || 0), plain(g.saved || 0), g.account || '', g.deadline || '', g.doneAt ? String(g.doneAt).slice(0, 10) : '', g.archived ? 'yes' : '', iso(g.updatedAt)]);
  return rows;
}
export function reconRows(state) {
  const n = names(state);
  const rows = [['ID', 'Account', 'Date', 'Real balance', 'App balance', 'Difference', 'Adjustment record ID', 'Updated']];
  for (const r of state.reconciliations || []) rows.push([r.id, n.acc(r.account), r.date, plain(r.real), plain(r.app), plain(r.diff), r.adjustment || '', iso(r.updatedAt)]);
  return rows;
}

export const TABLES = [
  ['Transactions', txRows], ['Accounts', accountRows], ['Invoices', invoiceRows], ['Clients', clientRows],
  ['Recurring', recurringRows], ['Goals', goalRows], ['Reconciliations', reconRows],
];

// CSV text, UTF-8 with a BOM, RFC 4180 quoting (a value starting with = + - @
// that is not a number gets a leading ' so a spreadsheet never runs it).
export function csvText(rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

// Sheets for xlsx.js: numbers stay numbers (amounts as money), the rest text.
const MONEY_COLS = new Set(['To amount', 'Amount', 'Base amount', 'Start balance', 'Target', 'Saved', 'Real balance', 'App balance', 'Difference', 'Hourly rate']);
export function workbookSheets(state) {
  return TABLES.map(([name, fn]) => {
    const rows = fn(state);
    const head = rows[0];
    const body = rows.slice(1).map((r) => r.map((v, i) => {
      if (v === '' || v == null) return null;
      if (MONEY_COLS.has(head[i])) return { v: Number(v), t: 'money' };
      if (head[i] === 'Rate') return { v: Number(v) };
      return { v: String(v), t: 'text' };
    }));
    return { name, rows: [head, ...body], cols: head.map((h) => Math.max(10, Math.min(28, h.length + 4))), filterRows: body.length };
  });
}

// ---------- Import (the same transactions CSV) ----------

const low = (s) => String(s ?? '').trim().toLowerCase();

// Is this the full export? (Its header row has ID, Date, Type, Amount and Base amount.)
export function isMoneyExport(rows) {
  const h = (rows?.[0] || []).map((c) => low(String(c).replace(/^﻿/, '')));
  return ['id', 'date', 'type', 'amount', 'base amount'].every((k) => h.includes(k));
}

// What the import would do, without changing anything: { add, duplicates,
// changed, deletedHere, invalid } (rows with a reason where useful).
export function previewImport(rows, state, { now = Date.now() } = {}) {
  const head = rows[0].map((c) => low(String(c).replace(/^﻿/, '')));
  const col = (name) => head.indexOf(low(name));
  // The export guards a cell starting with = + - @ with a ' (csvText): taken off again.
  const get = (row, name) => { const i = col(name); return i >= 0 && i < row.length ? String(row[i] ?? '').trim().replace(/^'(?=[=+\-@\t\r])/, '') : ''; };
  const baseCur = state.settings.currency;
  const byId = new Map(state.tx.map((t) => [t.id, t]));
  const keys = new Map();
  for (const t of state.tx) keys.set(txKey(t), (keys.get(txKey(t)) || 0) + 1);
  const findAcc = (id, name) => {
    if (id && state.settings.accounts.some((a) => a.id === id)) return id;
    const n = low(name);
    return n ? state.settings.accounts.find((a) => low(a.name) === n)?.id || null : null;
  };
  const findCat = (id, name, type) => {
    if (id && state.settings.categories.some((c) => c.id === id)) return id;
    const n = low(name);
    return (n && state.settings.categories.find((c) => c.type === type && low(c.name) === n)?.id) || (type === 'income' ? 'other-in' : 'other');
  };
  const findPerson = (id, name) => {
    if (id && (state.people || []).some((p) => p.id === id)) return { id };
    const n = low(name);
    if (!n) return null;
    const p = (state.people || []).find((x) => low(x.name) === n);
    return p ? { id: p.id } : { name: String(name).trim() };
  };
  const out = { add: [], duplicates: [], changed: [], deletedHere: [], invalid: [], newPeople: [] };
  const seen = new Set();
  let stamp = now;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !String(c ?? '').trim())) continue;
    const line = r + 1;
    const id = get(row, 'ID');
    const date = get(row, 'Date');
    const type = low(get(row, 'Type'));
    const amount = cents(get(row, 'Amount'));
    if (!isValidISO(date) || !['income', 'expense', 'transfer'].includes(type) || !(amount > 0)) { out.invalid.push({ line, reason: 'needs a date, a type and an amount' }); continue; }
    let extra = {};
    const otherText = get(row, 'Other fields');
    if (otherText) { try { const o = JSON.parse(otherText); if (o && typeof o === 'object' && !Array.isArray(o)) extra = o; } catch { out.invalid.push({ line, reason: 'Other fields is not readable' }); continue; } }
    const currency = (get(row, 'Currency') || baseCur).toUpperCase();
    const rateText = get(row, 'Rate');
    const rate = rateText === '' ? null : Number(rateText);
    const baseText = get(row, 'Base amount');
    const base = baseText === '' ? null : cents(baseText);
    const t = { ...extra, id: id || `imp-${uid()}`, date, type, amount, currency, rate: Number.isFinite(rate) ? rate : null };
    if (base != null) t.base = base;
    else if (currency === baseCur) { t.base = amount; t.rate = 1; }
    // The note exactly as written (spaces kept).
    const ni = col('Note');
    t.note = ni >= 0 && ni < row.length ? String(row[ni] ?? '').replace(/^'(?=[=+\-@\t\r])/, '') : '';
    if (type === 'transfer') {
      t.from = findAcc(get(row, 'From ID'), get(row, 'From'));
      t.to = findAcc(get(row, 'To ID'), get(row, 'To'));
      if (!t.from || !t.to || t.from === t.to) { out.invalid.push({ line, reason: 'the accounts of this move are not here' }); continue; }
      const ta = cents(get(row, 'To amount'));
      if (ta != null) t.toAmount = ta;
    } else {
      t.account = findAcc(get(row, 'Account ID'), get(row, 'Account'));
      if (!t.account) { out.invalid.push({ line, reason: `no account "${get(row, 'Account') || get(row, 'Account ID')}" here` }); continue; }
      t.category = findCat(get(row, 'Category ID'), get(row, 'Category'), type);
      const sub = get(row, 'Subcategory ID');
      if (sub && (state.settings.subcats || []).some((s) => s.id === sub && s.parent === t.category)) t.sub = sub;
      const who = findPerson(get(row, 'Person ID'), get(row, 'Person'));
      if (who?.id) t.person = who.id;
      else if (who?.name) { t.personName = who.name; if (!out.newPeople.includes(who.name)) out.newPeople.push(who.name); }
      if (/^(yes|true|1)$/i.test(get(row, 'Loan'))) t.loan = true;
      const inv = get(row, 'Invoice ID');
      if (inv) t.invoice = inv;
    }
    const rec = get(row, 'Recurring ID');
    if (rec) t.recurring = rec;
    const rc = get(row, 'Reconciliation ID');
    if (rc) t.reconcile = rc;
    const rep = get(row, 'Repriced from');
    if (rep) { try { t.repricedFrom = JSON.parse(rep); } catch { /* kept out: not readable */ } }
    // "Field: Project" columns (edited in a spreadsheet) win over the copy in Other fields.
    const fr = readImportFields(state, rows[0].map((c) => String(c ?? '').replace(/^﻿/, '').trim()), (h) => get(row, h), t.fields);
    if (Object.keys(fr.fields).length) t.fields = fr.fields;
    const created = Date.parse(get(row, 'Created'));
    t.createdAt = Number.isFinite(created) ? created : stamp;
    // Changed now, so the import syncs to your other devices.
    t.updatedAt = stamp++;
    if (id && byId.has(id)) {
      const mine = byId.get(id);
      (sameMoney(mine, t) ? out.duplicates : out.changed).push({ line, tx: t, here: mine });
      continue;
    }
    if (id && state.deleted?.[id]) { out.deletedHere.push({ line, tx: t }); continue; }
    if (id && seen.has(id)) { out.duplicates.push({ line, tx: t }); continue; }
    const k = txKey(t);
    if (keys.get(k) > 0) { keys.set(k, keys.get(k) - 1); out.duplicates.push({ line, tx: t }); continue; }
    if (id) seen.add(id);
    out.add.push(t);
  }
  return out;
}

// The same money on both sides (a duplicate, not a changed record).
const sameMoney = (a, b) => a.date === b.date && a.type === b.type && a.amount === b.amount && (a.currency || '') === (b.currency || '')
  && (a.account || '') === (b.account || '') && (a.from || '') === (b.from || '') && (a.to || '') === (b.to || '');

// Adds the preview's new rows (people named but not here are added first).
// Returns how many records were added. Existing records are never touched.
export function applyImport(state, preview, { ensurePerson, now = Date.now() } = {}) {
  let n = 0;
  for (const t of preview.add) {
    const rec = { ...t };
    if (rec.personName && ensurePerson) { rec.person = ensurePerson(state, rec.personName, now); delete rec.personName; }
    state.tx.push(rec);
    n++;
  }
  return n;
}
