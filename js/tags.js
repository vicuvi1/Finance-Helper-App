// Colour tags (#5). Pure; tested (web/financeTags.test.ts).
//
// A tag is still a #word in a record's note (model.js tagsOf): the search
// (#trip), the export's Tags column, Ask and the bot already read it there,
// and old records keep working as they are. A split line can carry its own
// #tag in its note. What this adds is how a tag looks, in the settings key
// `tagStyles`: { [tag]: { color: 1..8, archived?: true } } (a settings key
// travels with the sync; the newer settings win). Merging two tags rewrites
// the notes that use the old one (each record is touched, so the change
// syncs, is one Undo step and shows in Change history).

import { tagsOf, touch, B } from './model.js';
import { countsAsSpending, countsAsIncome, signed } from './catshare.js';
import { linesOf } from './splits.js';

export const COLORS = 8; // the category colours --c1..--c8
const TAG_RE = /^[\p{L}\p{N}_-]{1,30}$/u;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "#Trip " -> "trip"; '' when it cannot be a tag. */
export function normTag(s) {
  const t = String(s ?? '').trim().replace(/^#+/, '').toLowerCase();
  return TAG_RE.test(t) ? t : '';
}

/** A steady colour for a tag nobody coloured yet (same tag, same colour everywhere). */
export function autoColor(tag) {
  let h = 0;
  for (const ch of String(tag)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return (h % COLORS) + 1;
}

const styles = (state) => (state?.settings?.tagStyles && typeof state.settings.tagStyles === 'object' ? state.settings.tagStyles : {});
export function tagStyle(state, tag) {
  const s = styles(state)[tag] || {};
  const color = Number.isInteger(s.color) && s.color >= 1 && s.color <= COLORS ? s.color : autoColor(tag);
  return { color, archived: !!s.archived };
}

/** The tags of a record: its note's and its split lines' notes'. */
export function recordTags(t) {
  const out = tagsOf(t?.note);
  for (const l of Array.isArray(t?.splits) ? t.splits : []) for (const g of tagsOf(l?.note)) if (!out.includes(g)) out.push(g);
  return out;
}

/** Every tag (used ones, and styled ones nobody uses yet), most used first. */
export function tagList(state, { archived = false } = {}) {
  const n = new Map();
  for (const t of state.tx || []) for (const g of recordTags(t)) n.set(g, (n.get(g) || 0) + 1);
  for (const g of Object.keys(styles(state))) if (normTag(g) === g && !n.has(g)) n.set(g, 0);
  return [...n].map(([tag, count]) => ({ tag, count, ...tagStyle(state, tag) }))
    .filter((x) => archived || !x.archived)
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
}

/** Changes how a tag looks ({ color, archived }); the settings are stamped so it syncs. */
export function setTagStyle(state, tag, patch, now = Date.now()) {
  const g = normTag(tag);
  if (!g) return false;
  const next = { ...tagStyle(state, g), ...styles(state)[g], ...patch };
  const clean = {};
  if (Number.isInteger(next.color) && next.color >= 1 && next.color <= COLORS) clean.color = next.color;
  if (next.archived) clean.archived = true;
  state.settings.tagStyles = { ...styles(state), [g]: clean };
  state.settings.updatedAt = now;
  return true;
}

// ---------- Notes ----------

export const hasTag = (note, tag) => tagsOf(note).includes(normTag(tag));
const tagRe = (tag) => new RegExp(`(^|\\s)#${esc(tag)}(?=\\s|$)`, 'giu');

export function addTag(note, tag) {
  const g = normTag(tag);
  if (!g || hasTag(note, g)) return String(note || '');
  return `${String(note || '').trim()} #${g}`.trim();
}
export function removeTag(note, tag) {
  const g = normTag(tag);
  if (!g) return String(note || '');
  return String(note || '').replace(tagRe(g), '$1').replace(/\s{2,}/g, ' ').trim();
}
/** #from becomes #to (once: a note that has both keeps one #to). */
export function renameTag(note, from, to) {
  if (!hasTag(note, from)) return String(note || '');
  return hasTag(note, to) ? removeTag(note, from) : String(note || '').replace(tagRe(normTag(from)), `$1#${normTag(to)}`);
}

/** Applies `fn` to a record's note and its lines' notes; touches it when anything changed. */
function editNotes(t, fn, now) {
  let changed = false;
  const n = fn(t.note || '');
  if (n !== (t.note || '')) { t.note = n; changed = true; }
  if (Array.isArray(t.splits)) {
    const lines = t.splits.map((l) => {
      if (!l?.note) return l;
      const ln = fn(l.note);
      if (ln === l.note) return l;
      changed = true;
      const out = { ...l, note: ln };
      if (!ln) delete out.note;
      return out;
    });
    if (changed) t.splits = lines;
  }
  if (changed) touch(t, now);
  return changed;
}

/** Merge tag `from` into `to`: every note says #to instead, `from`'s look goes. Returns how many records changed. */
export function mergeTags(state, from, to, now = Date.now()) {
  const a = normTag(from);
  const b = normTag(to);
  if (!a || !b || a === b) return 0;
  let n = 0;
  for (const t of state.tx || []) if (recordTags(t).includes(a) && editNotes(t, (s) => renameTag(s, a, b), now)) n++;
  if (styles(state)[a]) {
    const next = { ...styles(state) };
    delete next[a];
    state.settings.tagStyles = next;
    state.settings.updatedAt = now;
  }
  return n;
}

/** Bulk: add or remove a tag on these records (on the record's own note). Returns { changed, skipped }. */
export function bulkTag(state, ids, tag, add = true, now = Date.now()) {
  const g = normTag(tag);
  const set = new Set(ids);
  let changed = 0;
  let skipped = 0;
  if (!g) return { changed, skipped: set.size };
  for (const t of state.tx || []) {
    if (!set.has(t.id)) continue;
    let ok = false;
    if (add) {
      const n = addTag(t.note, g);
      if (n !== (t.note || '')) { t.note = n; touch(t, now); ok = true; }
    } else ok = editNotes(t, (s) => removeTag(s, g), now);
    if (ok) changed++; else skipped++;
  }
  return { changed, skipped };
}

// ---------- Reports → Tags ----------

/**
 * Totals per tag between two dates, in the main currency, from the split lines
 * (a line's own #tag counts only its part): [{ tag, spent, earned, count,
 * months: { 'YYYY-MM': spent } }], biggest spending first. Refunds lower
 * spending; loans, moves and records that don't count are left out.
 */
export function tagTotals(state, from, to) {
  const by = new Map();
  for (const t of linesOf(state)) {
    if (!t || t.date < from || t.date > to) continue;
    const sp = countsAsSpending(t);
    const inc = countsAsIncome(t);
    if (!sp && !inc) continue;
    for (const g of tagsOf(t.note)) {
      const r = by.get(g) || { tag: g, spent: 0, earned: 0, count: 0, months: {}, ids: new Set() };
      const v = sp ? signed(t, B(t)) : B(t);
      if (sp) { r.spent += v; r.months[t.date.slice(0, 7)] = (r.months[t.date.slice(0, 7)] || 0) + v; } else r.earned += v;
      r.ids.add(t.id);
      by.set(g, r);
    }
  }
  return [...by.values()].map(({ ids, ...r }) => ({ ...r, count: ids.size }))
    .sort((a, b) => b.spent - a.spent || b.earned - a.earned || (a.tag < b.tag ? -1 : 1));
}

/** The lines behind one tag in a period, newest first. */
export function tagRecords(state, tag, from, to) {
  const g = normTag(tag);
  return linesOf(state)
    .filter((t) => t && t.date >= from && t.date <= to && (countsAsSpending(t) || countsAsIncome(t)) && tagsOf(t.note).includes(g))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
