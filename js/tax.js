// Taxes and paperwork (Money v2 phase 3): tax tags on records, the yearly tax
// summary and its rough estimate. Pure: no DOM, no saving. The screen is
// js/screens/taxes.js, the accountant export js/accountant.js, the numbers
// js/taxprofiles.js.
//
// Data (all optional fields that v3 code already keeps; no new top-level keys):
//   tx.tax          'taxable' | 'exempt' | 'deductible' | 'vat' | 'none'
//                   ('none' = "no tag", chosen on purpose over the category's default;
//                   missing = follow the category's default)
//   category.tax    the default tag for that category's records
//   settings.tax    { profile, overrides: { '2026': { pitBp, ... } }, updatedAt }
// The book is Phase 2's: read as t.book, else its account's book, else 'personal'.
// Tags never change any money total: they only sort records for taxes.
// NOT TAX ADVICE: every number here is an estimate to check with an accountant.

import { B, category, person, account, touch, knownRates } from './model.js';
import { countsAsIncome, countsAsSpending } from './catshare.js';
import { convert } from './fx.js';
import { PROFILES, DEFAULT_PROFILE, FIELDS } from './taxprofiles.js';

export const TAX_TAGS = [
  { id: 'taxable', label: 'Taxable income', short: 'Taxable', kind: 'income' },
  { id: 'exempt', label: 'Non-taxable', short: 'Non-taxable', kind: 'income' },
  { id: 'deductible', label: 'Deductible cost', short: 'Deductible', kind: 'expense' },
  { id: 'vat', label: 'VAT', short: 'VAT', kind: 'both' },
];
const TAG_IDS = new Set(TAX_TAGS.map((t) => t.id));
export const tagLabel = (id) => TAX_TAGS.find((t) => t.id === id)?.label || '';
export const tagFits = (tag, type) => { const k = TAX_TAGS.find((t) => t.id === tag)?.kind; return k === 'both' || k === type; };
export const tagsFor = (type) => TAX_TAGS.filter((t) => tagFits(t.id, type));

// Records that can carry a tax tag: real income and real spending (the shared
// rule: not loans, not points buys, not reconciliation adjustments, not moves).
export const taggable = (t) => countsAsIncome(t) || countsAsSpending(t);

export function bookOf(state, t) {
  return t.book ?? account(state, t.account)?.book ?? 'personal';
}
export const bookName = (state, id) => (state.settings.books?.list || []).find((b) => b.id === id)?.name || String(id || 'personal').replace(/^./, (c) => c.toUpperCase());

// The tag a record counts under: its own, else its category's default.
export function taxTagOf(state, t) {
  if (!taggable(t) || t.tax === 'none') return null;
  if (TAG_IDS.has(t.tax)) return tagFits(t.tax, t.type) ? t.tax : null;
  const def = category(state, t.category)?.tax;
  return TAG_IDS.has(def) && tagFits(def, t.type) ? def : null;
}
// 'own' (set on the record), 'category' (its category's default) or null.
export const tagSource = (state, t) => (t.tax === 'none' || TAG_IDS.has(t.tax) ? 'own' : taxTagOf(state, t) ? 'category' : null);

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Set the tag on many records at once. `tag`: a tag id; 'none' ("no tag", over
// the category's default); 'auto' (back to the category's default: the field
// goes). Records the tag does not fit are skipped. Every changed record is
// touched (so the change wins in a sync), and `before` holds each old value so
// undoTags puts it back exactly.
export function setTaxTag(state, ids, tag, now = Date.now()) {
  const want = new Set(ids);
  const before = [];
  let skipped = 0;
  const okTag = TAG_IDS.has(tag) || tag === 'none' || tag === 'auto';
  for (const t of state.tx) {
    if (!want.has(t.id)) continue;
    if (!okTag || !taggable(t) || (TAG_IDS.has(tag) && !tagFits(tag, t.type))) { skipped++; continue; }
    const old = has(t, 'tax') ? t.tax : undefined;
    const next = tag === 'auto' ? undefined : tag;
    if (old === next) continue;
    before.push({ id: t.id, tax: old });
    if (next === undefined) delete t.tax; else t.tax = next;
    touch(t, now);
  }
  return { changed: before.length, skipped, before };
}

export function undoTags(state, before, now = Date.now()) {
  const byId = new Map(before.map((b) => [b.id, b]));
  let n = 0;
  for (const t of state.tx) {
    const b = byId.get(t.id);
    if (!b) continue;
    if (b.tax === undefined) delete t.tax; else t.tax = b.tax;
    touch(t, now);
    n++;
  }
  return n;
}

// A category's default tag ('' or 'auto' removes it). Returns { old } or null.
export function setCategoryTag(state, catId, tag, now = Date.now()) {
  const c = category(state, catId);
  if (!c) return null;
  if (tag && tag !== 'auto' && (!TAG_IDS.has(tag) || !tagFits(tag, c.type))) return null;
  const old = c.tax;
  if (!tag || tag === 'auto') delete c.tax; else c.tax = tag;
  touch(c, now);
  state.settings.updatedAt = now;
  return { old };
}

// ---------- The profile and its numbers ----------

// The numbers for a year: the profile's newest year at or before it (or its
// first one), then the owner's overrides for that year on top.
export function profileFor(state, year) {
  const s = state.settings.tax || {};
  const p = PROFILES[s.profile] || PROFILES[DEFAULT_PROFILE];
  const years = Object.keys(p.years).map(Number).sort((a, b) => a - b);
  const pick = [...years].reverse().find((y) => y <= year) ?? years[0];
  const base = p.years[pick];
  const own = (s.overrides && s.overrides[String(year)]) || {};
  const numbers = {};
  const overridden = [];
  for (const f of FIELDS) {
    if (Number.isSafeInteger(own[f.id])) { numbers[f.id] = own[f.id]; overridden.push(f.id); }
    else if (Number.isSafeInteger(base[f.id])) numbers[f.id] = base[f.id];
  }
  const unconfirmed = (base.unconfirmed || []).filter((k) => !overridden.includes(k));
  const warnings = [];
  if (pick !== year && p.id !== 'none') warnings.push(`These are the ${pick} numbers: check them for ${year}.`);
  for (const k of unconfirmed) warnings.push(`${FIELDS.find((f) => f.id === k)?.label || k}: not confirmed for ${year}. Check it and type the right number.`);
  return { id: p.id, label: p.label, line: p.line, numbersYear: pick, numbers, overridden, checked: base.checked, sources: base.sources || [], deadlines: base.deadlines || [], unconfirmed, warnings };
}

export function setProfile(state, id, now = Date.now()) {
  if (!PROFILES[id]) return null;
  const old = state.settings.tax ? JSON.parse(JSON.stringify(state.settings.tax)) : null;
  state.settings.tax = { ...(state.settings.tax || {}), profile: id, updatedAt: now };
  state.settings.updatedAt = now;
  return { old };
}

// Your own number for one field of one year (an integer: basis points or bani;
// null puts the profile's number back). Returns false for a bad value.
export function setOverride(state, year, field, value, now = Date.now()) {
  if (!FIELDS.some((f) => f.id === field)) return false;
  if (value !== null && !(Number.isSafeInteger(value) && value >= 0 && (!field.endsWith('Bp') || value <= 10000))) return false;
  const cur = state.settings.tax || {};
  const y = String(year);
  const forYear = { ...((cur.overrides || {})[y] || {}) };
  if (value === null) delete forYear[field]; else forYear[field] = value;
  const overrides = { ...(cur.overrides || {}), [y]: forYear };
  if (!Object.keys(forYear).length) delete overrides[y];
  state.settings.tax = { ...cur, overrides, updatedAt: now };
  state.settings.updatedAt = now;
  return true;
}

// Puts settings.tax back to an earlier copy (Undo on the screen).
export function restoreTaxSettings(state, old, now = Date.now()) {
  if (old) state.settings.tax = { ...old, updatedAt: now };
  else delete state.settings.tax;
  state.settings.updatedAt = now;
}

// "12%" from basis points.
export const bpText = (bp) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const ofBp = (cents, bp) => Math.round((cents * bp) / 10000);

// ---------- The year ----------

// Every tax-tagged record of the year, oldest first.
export function taggedRows(state, year) {
  const y = String(year);
  return state.tx
    .filter((t) => String(t.date).startsWith(y))
    .map((t) => ({ t, tag: taxTagOf(state, t) }))
    .filter((x) => x.tag)
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : (a.t.createdAt || 0) - (b.t.createdAt || 0) || (a.t.id < b.t.id ? -1 : 1)))
    .map(({ t, tag }) => ({
      id: t.id,
      date: t.date,
      book: bookOf(state, t),
      tag,
      type: t.type,
      category: category(state, t.category)?.name || '',
      note: t.note || '',
      who: person(state, t.person)?.name || t.personName || '',
      account: account(state, t.account)?.name || '',
      currency: t.currency || state.settings.currency,
      amount: t.amount,
      rate: t.rate || 1,
      base: B(t),
      receipts: Array.isArray(t.receipts) ? t.receipts.filter((r) => typeof r === 'string') : [],
    }));
}

const emptyTotals = () => ({ taxable: 0, exempt: 0, deductible: 0, vatIn: 0, vatOut: 0, count: 0 });
function addTotals(tot, r) {
  tot.count++;
  if (r.tag === 'vat') { if (r.type === 'income') tot.vatIn += r.base; else tot.vatOut += r.base; }
  else tot[r.tag] += r.base;
}
function grouped(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.category || 'Other';
    const g = m.get(k) || { name: k, total: 0, count: 0 };
    g.total += r.base;
    g.count++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1));
}

// The year for taxes: totals by tag, taxable income by source, deductible
// costs by category, one row per book, month by month, untagged records and,
// for a set profile, a rough estimate and the deadlines. Money in your
// currency (bani), each record at the rate of its own day.
export function taxYear(state, year) {
  const rows = taggedRows(state, year);
  const totals = emptyTotals();
  const books = new Map([['personal', { book: 'personal', ...emptyTotals() }]]);
  const months = Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${String(i + 1).padStart(2, '0')}`, ...emptyTotals() }));
  for (const r of rows) {
    addTotals(totals, r);
    if (!books.has(r.book)) books.set(r.book, { book: r.book, ...emptyTotals() });
    addTotals(books.get(r.book), r);
    addTotals(months[Number(r.date.slice(5, 7)) - 1], r);
  }
  const y = String(year);
  const untagged = state.tx.filter((t) => String(t.date).startsWith(y) && taggable(t) && !taxTagOf(state, t) && t.tax !== 'none');
  const profile = profileFor(state, Number(year));
  const bookList = [...books.values()].map((b) => ({ ...b, profit: b.taxable - b.deductible }))
    .sort((a, b) => (a.book === 'personal' ? -1 : b.book === 'personal' ? 1 : b.taxable - a.taxable));
  return {
    year: Number(year),
    rows,
    totals: { ...totals, profit: totals.taxable - totals.deductible },
    incomeBySource: grouped(rows.filter((r) => r.tag === 'taxable')),
    exemptBySource: grouped(rows.filter((r) => r.tag === 'exempt')),
    deductibleByCategory: grouped(rows.filter((r) => r.tag === 'deductible')),
    books: bookList,
    months,
    untagged: { income: untagged.filter((t) => t.type === 'income').length, expense: untagged.filter((t) => t.type === 'expense').length },
    profile,
    estimate: estimate(state, rows, profile),
    deadlines: deadlines(profile, Number(year)),
  };
}

// The rows the estimate counts: with books on and a business profile, the
// business book only; otherwise every book.
function estimateRows(state, rows, profile) {
  if (state.settings.books?.on && (profile.id === 'entrepreneur' || profile.id === 'itpark')) return rows.filter((r) => r.book === 'business');
  return rows;
}

// A rough estimate, never more. null for the 'none' profile (totals only).
//   entrepreneur: income tax on (taxable income − deductible costs)
//   individual:   income tax on (taxable income − the personal exemption,
//                 which is not given once income reaches the cap)
//   itpark:       the single tax on taxable income (sales)
export function estimate(state, rows, profile) {
  if (profile.id === 'none') return null;
  const n = profile.numbers;
  const list = estimateRows(state, rows, profile);
  const income = list.filter((r) => r.tag === 'taxable').reduce((a, r) => a + r.base, 0);
  const costs = list.filter((r) => r.tag === 'deductible').reduce((a, r) => a + r.base, 0);
  if (profile.id === 'itpark') {
    const bp = n.turnoverBp || 0;
    return { income, costs: 0, exemption: 0, base: income, bp, tax: ofBp(income, bp), perMonth: null };
  }
  const bp = n.pitBp || 0;
  let exemption = 0;
  let base;
  if (profile.id === 'individual') {
    const cap = Number.isSafeInteger(n.exemptionCap) ? n.exemptionCap : Infinity;
    exemption = income < cap ? Math.min(income, n.exemption || 0) : 0;
    base = Math.max(0, income - exemption);
  } else base = Math.max(0, income - costs);
  return { income, costs: profile.id === 'individual' ? 0 : costs, exemption, base, bp, tax: ofBp(base, bp) };
}

// The year's deadlines, as dates.
export function deadlines(profile, year) {
  const out = [];
  for (const d of profile.deadlines || []) {
    if (d.md) out.push({ date: `${d.next ? year + 1 : year}-${d.md}`, label: d.label });
    else if (d.monthly) out.push({ date: null, label: `${d.label} (by the ${d.monthly}th)` });
  }
  return out;
}

// Show a total in USD or EUR too: at today's known rate (rates are units per
// 1 USD). null when no rate is known (never 1:1).
export function inCurrency(state, cents, cur) {
  const base = state.settings.currency || 'MDL';
  if (!cur || cur === base) return cents;
  return convert(cents, base, cur, knownRates(state));
}
