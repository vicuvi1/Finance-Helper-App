// Income sources (pure, tested): your own tags for where money comes from,
// e.g. "Job 1", "Job 2", "Cority". The list lives in a settings key
// (`settings.incomeSources`, merged by id like jars) and an Earned record
// points at one with the record field `incomeSource` (a different field from
// the old `source` that says where an imported record came from). Both are
// plain unknown-to-the-server fields, so the synced copy keeps them.
//
// A source is never deleted: archiving hides it from the pickers, but old
// records keep it and reports still count it. Nothing here changes a record
// on its own: the app asks first (suggestions), and every change goes through
// the normal save, so Undo and Change history see it.

import { addMonths, monthKey, monthLabel, daysInMonth } from './dates.js';
import { B } from './model.js';
import { countsAsIncome, isPointsReward } from './catshare.js';
import { linesOf } from './splits.js';

export const NONE = '__none';
export const COLOR_SLOTS = 8; // --c1 .. --c8
export const ICONS = ['💼', '🧑‍💻', '🏢', '🛠️', '🎓', '🏠', '📈', '🎁', '🛒', '🎨', '🚗', '💡'];
export const MAX_NAME = 30;

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** A name without spaces and punctuation, folded: "Job 2" and "job2" are the same. */
export const nameKey = (s) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- The list ----------

/** Every source, in the order you set (archived ones too). */
export function sourcesOf(state) {
  const list = Array.isArray(state?.settings?.incomeSources) ? state.settings.incomeSources.filter((s) => s && typeof s.id === 'string' && s.name) : [];
  return [...list].sort((a, b) => (Number.isFinite(a.order) ? a.order : 1e6) - (Number.isFinite(b.order) ? b.order : 1e6) || (a.createdAt || 0) - (b.createdAt || 0) || a.name.localeCompare(b.name));
}
export const activeSources = (state) => sourcesOf(state).filter((s) => !s.archived);
export const sourceById = (state, id) => (id ? sourcesOf(state).find((s) => s.id === id) || null : null);
export const sourceName = (state, id) => sourceById(state, id)?.name || '';
export const hasSources = (state) => sourcesOf(state).length > 0;

const sanitize = (f = {}) => {
  const out = {};
  if (f.color != null) out.color = Math.min(COLOR_SLOTS, Math.max(1, Math.round(Number(f.color)) || 1));
  if (typeof f.emoji === 'string' && f.emoji.trim()) out.emoji = f.emoji.trim().slice(0, 8);
  if (typeof f.currency === 'string' && /^[A-Za-z]{3,5}$/.test(f.currency.trim())) out.currency = f.currency.trim().toUpperCase();
  if (typeof f.account === 'string' && f.account) out.account = f.account;
  const exp = Math.round(Number(f.expected));
  if (exp > 0) out.expected = exp;
  const day = Math.round(Number(f.payday));
  if (day >= 1 && day <= 31) out.payday = day;
  return out;
};

const touchSettings = (state, now) => { state.settings.updatedAt = now; };
const uid = () => `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function freeColor(state) {
  const used = new Set(activeSources(state).map((s) => s.color));
  for (let c = 1; c <= COLOR_SLOTS; c++) if (!used.has(c)) return c;
  return (sourcesOf(state).length % COLOR_SLOTS) + 1;
}

/** Adds a source. { ok, source } or { ok: false, error: 'name' | 'exists', source? } (a name used before, even archived, is not added twice). */
export function addSource(state, fields = {}, now = Date.now()) {
  const name = String(fields.name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  if (!name || !nameKey(name)) return { ok: false, error: 'name' };
  const same = sourcesOf(state).find((s) => nameKey(s.name) === nameKey(name));
  if (same) return { ok: false, error: 'exists', source: same };
  if (!Array.isArray(state.settings.incomeSources)) state.settings.incomeSources = [];
  const list = state.settings.incomeSources;
  const order = list.reduce((m, s) => Math.max(m, Number.isFinite(s.order) ? s.order : -1), -1) + 1;
  const source = { id: uid(), name, color: freeColor(state), emoji: '💼', order, createdAt: now, updatedAt: now, ...sanitize(fields) };
  list.push(source);
  touchSettings(state, now);
  return { ok: true, source };
}

/** Changes a source. A blank optional field (currency, account, expected, payday) is cleared. */
export function updateSource(state, id, patch = {}, now = Date.now()) {
  const s = (state.settings.incomeSources || []).find((x) => x.id === id);
  if (!s) return { ok: false, error: 'missing' };
  if ('name' in patch) {
    const name = String(patch.name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    if (!name || !nameKey(name)) return { ok: false, error: 'name' };
    const clash = sourcesOf(state).find((x) => x.id !== id && nameKey(x.name) === nameKey(name));
    if (clash) return { ok: false, error: 'exists', source: clash };
    s.name = name;
  }
  const clean = sanitize(patch);
  for (const k of ['color', 'emoji']) if (k in clean) s[k] = clean[k];
  for (const k of ['currency', 'account', 'expected', 'payday']) {
    if (k in patch) { if (k in clean) s[k] = clean[k]; else delete s[k]; }
  }
  if ('archived' in patch) { if (patch.archived) s.archived = true; else delete s.archived; }
  s.updatedAt = now;
  touchSettings(state, now);
  return { ok: true, source: s };
}

export const archiveSource = (state, id, archived = true, now = Date.now()) => updateSource(state, id, { archived }, now);

/** Moves a source up (-1) or down (+1) among all sources. */
export function moveSource(state, id, dir, now = Date.now()) {
  const all = sourcesOf(state);
  const i = all.findIndex((s) => s.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= all.length) return false;
  [all[i], all[j]] = [all[j], all[i]];
  all.forEach((s, k) => { if (s.order !== k) { s.order = k; s.updatedAt = now; } });
  touchSettings(state, now);
  return true;
}

// ---------- On a record ----------

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const colorVar = (s) => (s?.color ? `var(--c${s.color})` : 'var(--faint)');

/** The small coloured tag shown on an Earned record in the Log (empty when it has no source). */
export function tagHTML(state, t) {
  const id = t?.type === 'income' && t.incomeSource;
  const s = id && sourceById(state, id);
  if (!s) return '';
  return `<span class="src-tag" data-testid="src-tag" data-src="${escHtml(s.id)}" style="--c:${colorVar(s)}" title="Income source: ${escHtml(s.name)}${s.archived ? ' (archived)' : ''}"><i aria-hidden="true"></i>${escHtml(s.name)}</span>`;
}

/** Records that can carry a source: money you earned (not a loan, a refund or a bank correction). */
export const canHaveSource = (t) => !!t && t.type === 'income' && !t.loan && !t.refund && !t.reconcile && !isPointsReward(t);

/** The record's source id when that source is in your list (archived ones too), else null. */
export const txSourceId = (state, t) => (t?.incomeSource && sourceById(state, t.incomeSource) ? t.incomeSource : null);

/** Sets (or, with null, clears) a record's source. True when something changed. */
export function setTxSource(t, id, now = Date.now()) {
  if (!canHaveSource(t)) return false;
  if (!id) { if (!('incomeSource' in t)) return false; delete t.incomeSource; } else { if (t.incomeSource === id) return false; t.incomeSource = id; }
  t.updatedAt = now;
  return true;
}

/** The source you used last for an Earned record like this: the same note, else the same category. Archived sources are not offered. */
export function rememberedSource(state, { category = null, note = '', excludeId = null } = {}) {
  const active = new Set(activeSources(state).map((s) => s.id));
  if (!active.size) return null;
  const n = fold(note).trim();
  let byNote = null;
  let byCat = null;
  const newer = (t, best) => !best || t.date > best.date || (t.date === best.date && (t.createdAt || 0) > (best.createdAt || 0));
  for (const t of state.tx) {
    if (t.type !== 'income' || !t.incomeSource || !active.has(t.incomeSource) || t.id === excludeId) continue;
    if (n && fold(t.note).trim() === n && newer(t, byNote)) byNote = t;
    if (category && t.category === category && newer(t, byCat)) byCat = t;
  }
  return (byNote || byCat)?.incomeSource || null;
}

// ---------- Typing a source ----------

/** "@job2" / "@Cority" (or just "job 2"): the active source it names, else null. A short start of a name works when only one source starts that way. */
export function findSourceByName(state, text) {
  const k = nameKey(String(text ?? '').replace(/^@/, ''));
  if (!k) return null;
  const act = activeSources(state);
  const exact = act.find((s) => nameKey(s.name) === k);
  if (exact) return exact;
  if (k.length < 3) return null;
  const starts = act.filter((s) => nameKey(s.name).startsWith(k));
  return starts.length === 1 ? starts[0] : null;
}

/** A source named inside a sentence ("how much from job 2 this year"): { source, rest } with its words taken out, or null. Archived sources count. */
export function sourceInText(state, text) {
  const q = fold(text);
  const all = sourcesOf(state).sort((a, b) => b.name.length - a.name.length);
  for (const s of all) {
    const words = fold(s.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!words.length) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}@])@?${words.map(esc).join('[\\s_-]*')}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(q)) return { source: s, rest: q.replace(re, '$1 ').replace(/\s+/g, ' ').trim() };
  }
  return null;
}

// ---------- "Create from your records" ----------

const isOtherIncomeCat = (c) => !c || c.id === 'other-in' || /^other income$/i.test(String(c.name || '').trim());
const pretty = (s) => String(s).trim().replace(/\s+/g, ' ');

/**
 * Sources your Earned records hint at, to confirm one by one. Categories
 * (except "Other income") and notes that repeat (2+ records). Records already
 * tagged, loans, refunds, "not income" and bank corrections are left out.
 * Returns [{ key, kind: 'category'|'note', name, count, total, ids }], biggest first.
 */
export function suggestSources(state, { limit = 10 } = {}) {
  const have = new Set(sourcesOf(state).map((s) => nameKey(s.name)));
  const cats = new Map();
  const notes = new Map();
  for (const t of state.tx) {
    if (!canHaveSource(t) || t.notIncome || t.incomeSource) continue;
    const cat = state.settings.categories.find((c) => c.id === t.category);
    if (cat && !isOtherIncomeCat(cat)) {
      const k = nameKey(cat.name);
      if (k && !have.has(k)) {
        const g = cats.get(k) || { key: `c:${k}`, kind: 'category', name: pretty(cat.name), count: 0, total: 0, ids: [], match: (x) => x.category === cat.id };
        g.count++; g.total += B(t); g.ids.push(t.id);
        cats.set(k, g);
      }
    }
    const note = pretty(t.note || '').replace(/#[\p{L}\p{N}_-]+/gu, '').trim();
    const nk = nameKey(note);
    if (note.length >= 2 && note.length <= MAX_NAME && nk && !have.has(nk) && !cats.has(nk) && !/^\d+$/.test(nk)) {
      const g = notes.get(nk) || { key: `n:${nk}`, kind: 'note', name: note.replace(/^./, (c) => c.toUpperCase()), count: 0, total: 0, ids: [] };
      g.count++; g.total += B(t); g.ids.push(t.id);
      notes.set(nk, g);
    }
  }
  const out = [...cats.values(), ...[...notes.values()].filter((g) => g.count >= 2 && !cats.has(g.key.slice(2)))];
  return out.map(({ match, ...g }) => g).sort((a, b) => b.count - a.count || b.total - a.total || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Creates the sources you confirmed and, when `tag` is on, puts each one on
 * its records that have none yet (note suggestions first, they are more
 * specific than a category). `chosen`: [{ key, name }]. Returns
 * { created: [source], tagged: number, ids: [tx id] }.
 */
export function applySuggestions(state, chosen, { tag = true, now = Date.now() } = {}) {
  const all = suggestSources(state, { limit: 1000 });
  const picked = chosen.map((c) => ({ c, g: all.find((x) => x.key === c.key) })).filter((x) => x.g)
    .sort((a, b) => (a.g.kind === b.g.kind ? 0 : a.g.kind === 'note' ? -1 : 1));
  const created = [];
  const ids = [];
  for (const { c, g } of picked) {
    const r = addSource(state, { name: c.name || g.name }, now);
    if (!r.ok) continue;
    created.push(r.source);
    if (!tag) continue;
    for (const id of g.ids) {
      const t = state.tx.find((x) => x.id === id);
      if (t && !t.incomeSource && setTxSource(t, r.source.id, now)) ids.push(id);
    }
  }
  return { created, tagged: ids.length, ids };
}

// ---------- Totals ----------

/** Earned money (in your main currency) per source for a period. Records with no source are "No source" (id NONE). */
export function sourceTotals(state, from, to) {
  const known = new Set(sourcesOf(state).map((s) => s.id));
  const by = new Map();
  let total = 0;
  const list = [];
  for (const t of linesOf(state)) { // a split income counts per line (js/splits.js)
    if (!countsAsIncome(t) || t.date < from || t.date > to) continue;
    const id = t.incomeSource && known.has(t.incomeSource) ? t.incomeSource : NONE;
    const v = B(t);
    const g = by.get(id) || { id, amount: 0, count: 0 };
    g.amount += v; g.count++;
    by.set(id, g);
    total += v;
    list.push(t);
  }
  const rows = [...by.values()].sort((a, b) => (a.id === NONE) - (b.id === NONE) || b.amount - a.amount).map((r) => ({ ...r, share: total ? r.amount / total : 0 }));
  return { total, rows, list };
}

/** The Earned records of one source in a period (newest first). NONE gives the ones without a source. */
export function sourceRecords(state, id, from, to) {
  const known = new Set(sourcesOf(state).map((s) => s.id));
  return linesOf(state).filter((t) => countsAsIncome(t) && t.date >= from && t.date <= to && (id === NONE ? !(t.incomeSource && known.has(t.incomeSource)) : t.incomeSource === id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
}

/**
 * The "Income by source" report: the last `months` months up to `today`'s.
 * { keys, rows: [{ id, name, color, emoji, archived, total, share, avg, count, byMonth: [cents] }], monthTotals: [cents],
 *   total, thisMonth: { total, rows }, lastMonth: { total } }
 * avg = total / the months since that source's first record in the window (at least 1).
 */
export function sourceReport(state, today, { months = 12 } = {}) {
  const end = monthKey(today);
  const keys = Array.from({ length: months }, (_, i) => addMonths(end, i - months + 1));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const known = new Map(sourcesOf(state).map((s) => [s.id, s]));
  const acc = new Map();
  for (const t of linesOf(state)) {
    if (!countsAsIncome(t)) continue;
    const i = idx.get(t.date.slice(0, 7));
    if (i == null || t.date > `${end}-${String(daysInMonth(end)).padStart(2, '0')}`) continue;
    const id = t.incomeSource && known.has(t.incomeSource) ? t.incomeSource : NONE;
    const g = acc.get(id) || { id, total: 0, count: 0, byMonth: Array(months).fill(0), first: months };
    const v = B(t);
    g.total += v; g.count++; g.byMonth[i] += v; g.first = Math.min(g.first, i);
    acc.set(id, g);
  }
  const total = [...acc.values()].reduce((a, g) => a + g.total, 0);
  const rows = [...acc.values()].map((g) => {
    const s = known.get(g.id);
    return {
      id: g.id, name: s ? s.name : 'No source', color: s ? s.color : 0, emoji: s?.emoji || '', archived: !!s?.archived,
      total: g.total, share: total ? g.total / total : 0, avg: Math.round(g.total / Math.max(1, months - g.first)), count: g.count, byMonth: g.byMonth,
    };
  }).sort((a, b) => (a.id === NONE) - (b.id === NONE) || b.total - a.total);
  const monthTotals = keys.map((_, i) => rows.reduce((a, r) => a + r.byMonth[i], 0));
  const m = sourceTotals(state, `${end}-01`, `${end}-31`);
  const pk = addMonths(end, -1);
  return { keys, labels: keys.map((k) => monthLabel(k, true).slice(0, 3)), rows, monthTotals, total, thisMonth: m, lastMonth: sourceTotals(state, `${pk}-01`, `${pk}-31`) };
}
