// The accountant export (Money v2 phase 3): one Excel file for one year, only
// the tax-tagged records, each receipt as a link to the file in the owner's
// Google Drive (owner, 2026-11-12: "Excel + Drive links", no ZIP), and a
// Totals sheet. Pure: builds the sheets for xlsx.js; the screen downloads them.

import { taxYear, tagLabel, bookName, bpText } from './tax.js';
import { monthLabel } from './dates.js';

export const NOT_ADVICE = 'Not tax advice: check with an accountant.';

export const accountantColumns = (base = 'MDL') => ['Date', 'Book', 'Type', 'Amount', 'Currency', 'Rate', base, 'Category', 'Tax tag', 'Client/Person', 'Invoice', 'Note', 'Receipt link', 'More receipts'];

export const driveLink = (driveId) => `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`;

// One receipt id → its link, or a plain note when it is not in Drive yet.
export function receiptLink(index, rid) {
  const r = index?.[rid];
  if (r?.driveId && !r.gone) return { url: driveLink(r.driveId), name: r.name || 'Receipt' };
  if (r?.gone) return { url: null, text: 'Receipt removed' };
  return { url: null, text: 'Receipt not in Google Drive yet' };
}

const q = (s) => String(s).replace(/"/g, '""');
// Excel shows a link from a HYPERLINK formula (xlsx.js writes formulas as they are).
const linkCell = (l) => (l.url ? { f: `HYPERLINK("${q(l.url)}","${q(String(l.name).slice(0, 200))}")` } : { v: l.text, t: 'text' });

// The rows of the Entries sheet (header first), as plain values: for tests
// and for anyone who wants a CSV.
export function accountantRows(state, year, receiptIndex = {}) {
  const base = state.settings.currency || 'MDL';
  const t = taxYear(state, year);
  const invoiceOf = new Map((state.invoices || []).filter((i) => i.paidTx).map((i) => [i.paidTx, i.number || i.id]));
  const body = t.rows.map((r) => {
    const links = r.receipts.map((rid) => receiptLink(receiptIndex, rid));
    return {
      cells: [r.date, bookName(state, r.book), r.type === 'income' ? 'Income' : 'Cost', r.amount, r.currency, r.rate, r.base, r.category, tagLabel(r.tag), r.who, invoiceOf.get(r.id) || '', r.note],
      links,
    };
  });
  return { header: accountantColumns(base), body, year: t };
}

const money = (c) => ({ v: c / 100, t: 'money' });

export function accountantSheets(state, year, receiptIndex = {}) {
  const base = state.settings.currency || 'MDL';
  const { header, body, year: t } = accountantRows(state, year, receiptIndex);
  const entries = body.map(({ cells, links }) => {
    const [date, book, type, amount, cur, rate, inBase, ...rest] = cells;
    const first = links[0] ? linkCell(links[0]) : null;
    const more = links.slice(1).map((l) => l.url || l.text).join(' ');
    return [{ v: date, t: 'date' }, book, type, money(amount), cur, rate, money(inBase), ...rest.map((v) => (v === '' ? null : { v: String(v), t: 'text' })), first, more || null];
  });
  const p = t.profile;
  const est = t.estimate;
  const b = (v) => ({ v, bold: true });
  const totals = [
    [b(`Taxes ${t.year}: tagged records, in ${base} at the rate of each day`)],
    [b(NOT_ADVICE)],
    [`Tax situation: ${p.label}. Numbers checked ${p.checked}${p.sources.length ? `; sources: ${p.sources.join('; ')}` : ''}.`],
    ...p.warnings.map((w) => [`Check: ${w}`]),
    [],
    [b('By tag'), b('Records'), b(`In ${base}`)],
    ['Taxable income', t.rows.filter((r) => r.tag === 'taxable').length, money(t.totals.taxable)],
    ['Non-taxable income', t.rows.filter((r) => r.tag === 'exempt').length, money(t.totals.exempt)],
    ['Deductible costs', t.rows.filter((r) => r.tag === 'deductible').length, money(t.totals.deductible)],
    ['VAT on income', t.rows.filter((r) => r.tag === 'vat' && r.type === 'income').length, money(t.totals.vatIn)],
    ['VAT on costs', t.rows.filter((r) => r.tag === 'vat' && r.type !== 'income').length, money(t.totals.vatOut)],
    [b('Taxable income minus deductible costs'), '', { ...money(t.totals.profit), bold: true }],
    [],
    [b('By book'), b('Taxable'), b('Non-taxable'), b('Deductible'), b('VAT on income'), b('VAT on costs')],
    ...t.books.map((x) => [bookName(state, x.book), money(x.taxable), money(x.exempt), money(x.deductible), money(x.vatIn), money(x.vatOut)]),
    [],
    [b('By month'), b('Taxable'), b('Non-taxable'), b('Deductible'), b('VAT on income'), b('VAT on costs')],
    ...t.months.map((m) => [monthLabel(m.key), money(m.taxable), money(m.exempt), money(m.deductible), money(m.vatIn), money(m.vatOut)]),
    ...(est ? [[], [b('Rough estimate (not tax advice)')],
      ['Base', '', money(est.base)],
      ...(est.exemption ? [['Personal exemption taken off', '', money(est.exemption)]] : []),
      [`Rate ${bpText(est.bp)}`, '', { ...money(est.tax), bold: true }]] : []),
  ];
  return [
    { name: 'Entries', cols: [12, 12, 8, 13, 9, 9, 13, 20, 16, 20, 14, 30, 26, 30], filterRows: entries.length, rows: [header, ...entries] },
    { name: 'Totals', header: false, cols: [40, 16, 16, 16, 16, 16], rows: totals },
  ];
}

export const accountantFileName = (year) => `taxes-${year}-for-accountant.xlsx`;
