// Learned category rules (Money phase 5, "less typing"). Pure: no DOM, no
// storage, so Finance Helper, Life System's Money page and the Telegram bot
// (bundled into api/_bot/bot.mjs) share one rule.
//
// - What you chose before is worked out from your own records each time
//   (cached), never stored: nothing learned needs syncing or can clash.
//   "LINELLA 23", "Plata la Linella SRL #4411" and "linella" are one merchant.
// - Only explicit rules are stored, in settings.rules (as before). They now
//   carry `updatedAt` and merge as a list by id; a deleted rule leaves a
//   tombstone in state.deleted, so an older copy can't bring it back.
// - Records filed by guess (catBy 'auto') and captured or auto-logged records
//   you never confirmed are not evidence: the app must not learn from itself.
//
// Levels: 'sure' (a rule, or 90%+ of at least 3 records), 'maybe' (60%+),
// else 'guess'. Only 'sure' may file something without a tap.

export const SURE = 0.9;
export const MAYBE = 0.6;
export const SURE_MIN = 3;
const HALF_LIFE_DAYS = 180;
const DAY = 86400000;

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Words that never name a merchant: bank and card boilerplate, legal forms,
// places, little words (EN/RO/RU). Bank names too, so "MAIB*UBER TRIP" is Uber.
const STOP = new Set(('plata platii plati pentru from with the and for at to of in on by la de din si cu pe al ale '
  + 'card pos atm srl sa ii ip md mda chisinau chisinaului balti moldova str nr bd bul via transfer payment purchase pay paid '
  + 'achitare cumparare comision operatiune tranzactie tranzactia retragere online web www com net org ltd llc inc gmbh ooo '
  + 'maib micb victoriabank moldindconbank eximbank fincombank energbank paynet mpay revolut visa mastercard '
  + 'оплата покупка перевод платеж для ооо').split(' '));
// Merchants that are a family of services: the next word says which one.
const FAMILY = new Set(['uber', 'bolt', 'yandex', 'google', 'apple', 'amazon', 'paypal', 'steam', 'microsoft']);

// "LINELLA 23" -> "linella"; "Plata la LINELLA SRL #4411" -> "linella";
// "MAIB*UBER TRIP 12/11" -> "uber trip". '' when nothing names a merchant.
export function merchantOf(note) {
  const words = fold(note)
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/[\p{N}]+/gu, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
  if (!words.length) return '';
  return FAMILY.has(words[0]) && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

const isOther = (id) => id === 'other' || id === 'other-in';
const validCat = (state, id, type) => (state.settings?.categories || []).some((c) => c.id === id && c.type === type && !c.archived);

/** A record that counts as your own choice (not a guess, not unconfirmed). */
export function isEvidence(t) {
  if (!t || (t.type !== 'expense' && t.type !== 'income') || t.loan || t.reconcile) return false;
  if (!t.category || isOther(t.category) || t.catBy === 'auto') return false;
  if ((t.source === 'capture' || t.source === 'auto') && !t.confirmedAt) return false;
  return true;
}

// merchant|type -> { cats: Map(id -> weight), subs, books, n, last }, rebuilt
// when the records change (count + newest updatedAt).
const cache = new WeakMap();
export function choiceTable(state, now = Date.now()) {
  const tx = state.tx || [];
  let last = 0;
  for (const t of tx) if ((t.updatedAt || 0) > last) last = t.updatedAt || 0;
  const key = `${tx.length}|${last}|${Math.floor(now / DAY)}`;
  const hit = cache.get(tx);
  if (hit && hit.key === key) return hit.table;
  const table = new Map();
  for (const t of tx) {
    if (!isEvidence(t)) continue;
    const m = merchantOf(t.note);
    if (!m) continue;
    const k = `${t.type}|${m}`;
    let row = table.get(k);
    if (!row) table.set(k, (row = { merchant: m, type: t.type, cats: new Map(), subs: new Map(), books: new Map(), n: 0, last: '', label: t.note }));
    // Recent choices outweigh old ones (half-life 180 days).
    const at = Date.parse(`${t.date}T12:00:00Z`);
    const w = Number.isFinite(at) ? Math.pow(0.5, Math.max(0, now - at) / (HALF_LIFE_DAYS * DAY)) : 1;
    row.cats.set(t.category, (row.cats.get(t.category) || 0) + w);
    if (t.sub) row.subs.set(`${t.category}|${t.sub}`, (row.subs.get(`${t.category}|${t.sub}`) || 0) + w);
    const book = t.book ?? 'personal';
    row.books.set(book, (row.books.get(book) || 0) + w);
    row.n++;
    if (String(t.date) >= row.last) { row.last = String(t.date); row.label = t.note; }
  }
  cache.set(tx, { key, table });
  return table;
}

const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0);
const levelOf = (confidence, n) => (confidence >= SURE && n >= SURE_MIN ? 'sure' : confidence >= MAYBE ? 'maybe' : 'guess');

/** An explicit rule ("contains linella -> Food") for a note: the longest match wins. */
export function ruleFor(state, note, type) {
  const n = fold(note);
  if (!n) return null;
  return (state.settings?.rules || [])
    .filter((r) => r && r.match && (r.type === type || r.type === 'any') && n.includes(fold(r.match)) && validCat(state, r.category, type))
    .sort((a, b) => b.match.length - a.match.length)[0] || null;
}

/** What your records say about this merchant (no rules, no keywords), or null. */
export function merchantChoice(state, note, type, now = Date.now()) {
  const m = merchantOf(note);
  if (!m) return null;
  const row = choiceTable(state, now).get(`${type}|${m}`);
  if (!row) return null;
  const cats = top(row.cats).filter(([id]) => validCat(state, id, type));
  if (!cats.length) return null;
  const total = sum(row.cats);
  const confidence = Math.round((cats[0][1] / total) * 100) / 100;
  const subs = top(row.subs).filter(([k]) => k.startsWith(`${cats[0][0]}|`));
  const books = top(row.books);
  const book = books.length && books[0][1] / sum(row.books) >= SURE ? books[0][0] : null;
  return {
    merchant: m,
    category: cats[0][0],
    sub: subs.length && subs[0][1] / cats[0][1] >= MAYBE ? subs[0][0].split('|')[1] : null,
    book,
    confidence,
    n: row.n,
    level: levelOf(confidence, row.n),
    alternatives: cats.map(([id, w]) => ({ category: id, confidence: Math.round((w / total) * 100) / 100 })),
  };
}

// Categories you use most (last 90 days), for chips when nothing is known.
function usual(state, type, now) {
  const from = new Date(now - 90 * DAY).toISOString().slice(0, 10);
  const n = new Map();
  for (const t of state.tx || []) if (t.type === type && !isOther(t.category) && String(t.date) >= from) n.set(t.category, (n.get(t.category) || 0) + 1);
  return top(n).map(([id]) => id);
}

/**
 * The suggestion for a note: category, subcategory, book, how sure, why, and
 * up to 3 chips (`alternatives`). `guess` is Finance's own keyword guess
 * (model.js suggestCategory), used after rules and your records.
 */
export function suggest(state, { note, type = 'expense' }, { guess = null, now = Date.now(), chips = 3 } = {}) {
  const m = merchantOf(note);
  const rule = ruleFor(state, note, type);
  const mine = merchantChoice(state, note, type, now);
  let out;
  if (rule) out = { category: rule.category, sub: rule.sub || null, book: rule.book || mine?.book || null, confidence: 1, level: 'sure', why: 'rule', rule: rule.id, n: mine?.n || 0 };
  else if (mine) out = { category: mine.category, sub: mine.sub, book: mine.book, confidence: mine.confidence, level: mine.level, why: 'merchant', n: mine.n };
  else if (guess && validCat(state, guess, type) && !isOther(guess)) out = { category: guess, sub: null, book: null, confidence: 0.3, level: 'guess', why: 'keyword', n: 0 };
  else out = { category: null, sub: null, book: null, confidence: 0, level: 'guess', why: 'none', n: 0 };
  const list = [out.category, ...(mine?.alternatives || []).map((a) => a.category), guess, ...usual(state, type, now), ...(state.settings?.categories || []).filter((c) => c.type === type).map((c) => c.id)];
  const seen = new Set();
  out.alternatives = list.filter((id) => id && !isOther(id) && validCat(state, id, type) && !seen.has(id) && seen.add(id)).slice(0, chips);
  out.merchant = m;
  return out;
}

/** May this suggestion file a record without a tap? Only when sure. */
export const canAutoFile = (s) => !!s && s.level === 'sure' && !!s.category;

// ---------- Explicit rules (stored in settings.rules) ----------

const ruleId = () => `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Adds a rule, or changes the one with the same text and type (its id stays,
 * so two devices editing it merge). `book` only when given.
 */
export function addRule2(state, { match, type = 'expense', category, book, sub, learned }, now = Date.now()) {
  const m = fold(match).trim();
  if (!m || !category) return null;
  const rules = Array.isArray(state.settings.rules) ? state.settings.rules : [];
  const same = rules.filter((r) => r && fold(r.match) === m && r.type === type);
  const keep = same[0];
  const rule = { ...(keep || {}), id: keep?.id || ruleId(), match: m, type, category, createdAt: keep?.createdAt || now, updatedAt: now };
  if (book) rule.book = book; else delete rule.book;
  if (sub) rule.sub = sub; else delete rule.sub;
  if (learned) rule.learned = true; else delete rule.learned;
  const gone = same.slice(1).map((r) => r.id);
  if (gone.length) state.deleted = { ...(state.deleted || {}), ...Object.fromEntries(gone.map((id) => [id, now])) };
  state.settings.rules = [...rules.filter((r) => !same.includes(r)), rule];
  return rule;
}

/** Deletes a rule; the tombstone keeps it deleted on every device. */
export function removeRule2(state, id, now = Date.now()) {
  const had = (state.settings.rules || []).some((r) => r?.id === id);
  state.settings.rules = (state.settings.rules || []).filter((r) => r?.id !== id);
  if (had) state.deleted = { ...(state.deleted || {}), [id]: now };
  return had;
}

/**
 * Two copies of the rules list: by id, the newer one wins; a rule without
 * `updatedAt` (made before phase 5, or by an older device) counts as old as
 * its side's settings. Tombstoned ids are dropped, so an older device's stale
 * list can't bring a deleted rule back, and a new rule it never saw stays.
 */
export function mergeRules(local = [], remote = [], deleted = {}, localAt = 0, remoteAt = 0) {
  const by = new Map();
  const own = new Map();
  const put = (r, at) => {
    if (!r || typeof r !== 'object' || !r.match) return;
    const id = r.id || `rule-${fold(r.match)}-${r.type || 'expense'}`;
    const x = { ...r, id, updatedAt: r.updatedAt || at || 0 };
    const mine = by.get(id);
    if (!mine || x.updatedAt > mine.updatedAt || (x.updatedAt === mine.updatedAt && JSON.stringify(x) > JSON.stringify(mine))) {
      by.set(id, x);
      own.set(id, r.updatedAt || r.createdAt || 0);
    }
  };
  for (const r of Array.isArray(local) ? local : []) put(r, localAt);
  for (const r of Array.isArray(remote) ? remote : []) put(r, remoteAt);
  // A tombstone is judged on the rule's own time: an older device never sets
  // `updatedAt` (and makes a new id for each change), so its copy of a
  // deleted rule is always the stale one.
  return [...by.values()].filter((r) => !(deleted[r.id] && deleted[r.id] >= (own.get(r.id) ?? r.updatedAt)));
}

/**
 * The Rules screen: your rules, then what was learned from your records
 * (read-only, merchants with 2+ records), each with how sure it is.
 */
export function rulesView(state, now = Date.now()) {
  const name = (id) => (state.settings?.categories || []).find((c) => c.id === id);
  const rules = (state.settings?.rules || []).filter((r) => r && r.match).map((r) => {
    const c = name(r.category);
    return { id: r.id, match: r.match, type: r.type || 'expense', category: r.category, categoryName: c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : r.category, book: r.book || null, learned: !!r.learned, updatedAt: r.updatedAt || 0 };
  }).sort((a, b) => a.match.localeCompare(b.match));
  const ruled = new Set(rules.map((r) => `${r.type}|${merchantOf(r.match)}`));
  const learned = [];
  for (const [k, row] of choiceTable(state, now)) {
    if (row.n < 2 || ruled.has(k)) continue;
    const mc = merchantChoice(state, row.label, row.type, now);
    if (!mc) continue;
    const c = name(mc.category);
    learned.push({ merchant: row.merchant, label: row.label, type: row.type, category: mc.category, categoryName: c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : mc.category, confidence: mc.confidence, level: mc.level, n: row.n, book: mc.book });
  }
  learned.sort((a, b) => b.n - a.n || a.merchant.localeCompare(b.merchant));
  return { rules, learned };
}
