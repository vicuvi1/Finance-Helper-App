// Shop names cleaned up: "LINELLA SRL 123", "Linella" and "linella #4411" are one shop, so
// categories and reports group them. Careful by design: only notes that are nothing but the
// shop's name (after numbers, punctuation and forms like SRL / SA are removed) are joined, so
// "Linella" and "LINELLA SRL 123" become one, while "linella bread" (your own words) stays apart.
//  - New records from your phone or a bank import get the spelling you already use.
//  - Old ones: "Do this next" offers the groups written several ways; you tick and Tidy (Undo works).
// Pure and tested (tests/shopnames.test.js).

import { touch } from './model.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const FORMS = /\b(s\.?r\.?l|s\.?a|i\.?i|i\.?c\.?s|ltd|llc|inc|gmbh|ooo|srl|sa|ii|ics)\b\.?/g;
const PLACES = /\b(chisinau|kishinev|md|mda|moldova|balti|com|www)\b/g;

/** The note reduced to its words that aren't numbers, legal forms or places. */
export function cleanName(note) {
  return fold(note).replace(/#[\p{L}\p{N}_-]+/gu, ' ').replace(/\b(s\.r\.l|s\.a|i\.i|i\.c\.s)\b\.?/g, ' ')
    .replace(/[\p{N}]+/gu, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(FORMS, ' ').replace(PLACES, ' ').replace(/\s+/g, ' ').trim();
}

const PAY_WORDS = new Set(['plata', 'la', 'achitare', 'tranzactie', 'cumparatura', 'payment', 'purchase', 'pos', 'at', 'card', 'оплата', 'покупка', 'в']);

/**
 * The shop a note names, as its cleaned words ("LINELLA SRL 123" → "linella"), when the note is a
 * short name (up to 4 words) and not a sentence; '' otherwise. Notes with the same key are one shop.
 */
const keyCache = new Map();
export function shopKey(note) {
  const hit = keyCache.get(note);
  if (hit !== undefined) return hit;
  const k = shopKeyOf(note);
  if (keyCache.size > 20000) keyCache.clear();
  keyCache.set(note, k);
  return k;
}
function shopKeyOf(note) {
  const words = cleanName(note).split(' ').filter((w) => w && !PAY_WORDS.has(w));
  if (!words.length || words.length > 4 || words.join('').length < 2) return '';
  return words.join(' ');
}

/** A spelling that can be joined: a bank's label (capitals, SRL, a code of 3+ digits or #) or already clean. */
export function joinable(note) {
  const raw = String(note || '');
  const letters = raw.replace(/[^\p{L}]/gu, '');
  const caps = letters.length >= 3 && letters === letters.toUpperCase();
  const label = caps || /\b(s\.?r\.?l|s\.?a|ltd|llc|ooo)\b/i.test(raw) || /\d{3,}|#\w/.test(raw);
  return label || cleanName(raw) === fold(raw).replace(/\s+/g, ' ').trim();
}

const pretty = (key) => key.replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** The spelling you use most for a shop (ties: the one with lower case letters, then the shorter). */
function bestSpelling(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (/[a-z]/.test(b[0]) - /[a-z]/.test(a[0])) || a[0].length - b[0].length)[0][0];
}

/** Shops written in more than one way: [{key, canonical, variants: [{note, count}], ids}], most records first. */
export function nameGroups(state) {
  const by = new Map();
  for (const t of state.tx || []) {
    if ((t.type !== 'expense' && t.type !== 'income') || !t.note || !joinable(t.note)) continue;
    const key = shopKey(t.note);
    if (!key) continue;
    const g = by.get(key) || { key, counts: new Map(), ids: [] };
    g.counts.set(t.note, (g.counts.get(t.note) || 0) + 1);
    g.ids.push(t.id);
    by.set(key, g);
  }
  const hidden = state.settings?.shopNamesKept || {};
  const out = [];
  for (const g of by.values()) {
    if (g.counts.size < 2 || hidden[g.key]) continue;
    const canonical = bestSpelling(g.counts);
    out.push({ key: g.key, canonical: canonical === canonical.toUpperCase() ? pretty(g.key) : canonical, variants: [...g.counts.entries()].map(([note, count]) => ({ note, count })).sort((a, b) => b.count - a.count), ids: g.ids });
  }
  return out.sort((a, b) => b.ids.length - a.ids.length);
}

/** The spelling a new record from the phone or the bank should use. */
export function canonicalFor(state, note) {
  const key = joinable(note) ? shopKey(note) : '';
  if (!key) return note;
  const counts = new Map();
  for (const t of state.tx || []) if (t.note && joinable(t.note) && shopKey(t.note) === key) counts.set(t.note, (counts.get(t.note) || 0) + 1);
  if (!counts.size) return note === note.toUpperCase() ? pretty(key) : note;
  const best = bestSpelling(counts);
  return best === best.toUpperCase() ? pretty(key) : best;
}

/** Writes one spelling on every record of the group. Returns how many changed. */
export function tidyGroup(state, group, name = group.canonical, now = Date.now()) {
  let n = 0;
  const ids = new Set(group.ids);
  for (const t of state.tx || []) {
    if (!ids.has(t.id) || t.note === name) continue;
    t.note = name;
    touch(t, now);
    n++;
  }
  return n;
}

/** "Keep them as they are": not offered again. */
export function keepGroup(state, key, now = Date.now()) {
  state.settings.shopNamesKept = { ...(state.settings.shopNamesKept || {}), [key]: true };
  state.settings.updatedAt = now;
}
