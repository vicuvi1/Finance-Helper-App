// A big synced copy of Money travels to the server in pieces, exactly the way
// Life System stores it (its src/core/settingParts.ts and src/core/textHash.ts,
// ported to plain JS so the server function and this app share one copy).
//
// On the server a big value is stored as:
//   settings.value            a short manifest: the pieces' names, in order
//   setting_parts(key, id)    the pieces (id = the fingerprint of its text)
// NEVER change how hash64 or splitText work: the pieces already stored on the
// server are named by them (tests/parts.test.js pins the values Life System makes).

/** 64 bits of the text's UTF-16 units as 16 hex letters (two independent 32-bit mixes). */
export function hash64(text, from = 0, to = text.length) {
  let h1 = 0xdeadbeef ^ (to - from);
  let h2 = 0x41c6ce57 ^ (to - from);
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export const PARTS_TABLE = 'setting_parts';
export const PARTS_OK_TABLE = 'setting_parts_ok';
export const PARTS_DDL = [
  `CREATE TABLE IF NOT EXISTS ${PARTS_TABLE} (key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (key, id))`,
  `CREATE TABLE IF NOT EXISTS ${PARTS_OK_TABLE} (parts_ok INTEGER NOT NULL CHECK (parts_ok = 1))`,
];

export const travelsInParts = (key) => /^app_sync_/.test(key);
/** A value up to this long (characters) is stored whole. */
export const WHOLE_UP_TO = 100_000;
export const PART_MIN = 8_000;
export const PART_MAX = 128_000;
const CUT_MASK = 0x7f;
const WINDOW = 24;

/** Cuts a text into pieces at places that depend only on the text around them. */
export function splitText(text) {
  const n = text.length;
  if (n <= PART_MAX) return [text];
  const out = [];
  let start = 0;
  let i = PART_MIN;
  while (i < n) {
    let cut = -1;
    const max = Math.min(n, start + PART_MAX);
    for (let j = Math.max(i, start + PART_MIN); j < max - 2; j++) {
      if (text.charCodeAt(j) !== 125 || text.charCodeAt(j + 1) !== 44 || text.charCodeAt(j + 2) !== 123) continue;
      let h = 0x811c9dc5;
      for (let k = j - WINDOW; k <= j; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619);
      h ^= h >>> 15;
      if ((h & CUT_MASK) === 0) {
        cut = j + 1;
        break;
      }
    }
    if (cut < 0) {
      if (max >= n) break;
      cut = max;
      const c = text.charCodeAt(cut - 1);
      if (c >= 0xd800 && c <= 0xdbff) cut--;
    }
    out.push(text.slice(start, cut));
    start = cut;
    i = start + PART_MIN;
  }
  if (start < n) out.push(text.slice(start));
  return out;
}

export const MANIFEST_HEAD = '{"lifeParts":1,';
export const looksLikeManifest = (v) => typeof v === 'string' && v.startsWith(MANIFEST_HEAD);
const sumOf = (p, len) => hash64(`${p.join(',')}|${len}`);

/** The manifest of a text and its pieces ({id, text}). */
export function manifestOf(key, text) {
  const parts = splitText(text).map((t) => ({ id: hash64(t), text: t }));
  const p = parts.map((x) => x.id);
  const m = { lifeParts: 1, key, len: text.length, sum: sumOf(p, text.length), p, n: parts.map((x) => x.text.length) };
  return { manifest: JSON.stringify(m), parts };
}

/** A manifest read back, or null when the text isn't one (or was damaged). */
export function parseManifest(text) {
  if (!looksLikeManifest(text)) return null;
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || m.lifeParts !== 1 || typeof m.key !== 'string' || !Array.isArray(m.p) || !Array.isArray(m.n) || m.p.length !== m.n.length || !m.p.length) return null;
  if (!m.p.every((x) => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)) || !m.n.every((x) => Number.isInteger(x) && x >= 0)) return null;
  if (m.n.reduce((a, b) => a + b, 0) !== m.len || sumOf(m.p, m.len) !== m.sum) return null;
  return m;
}

export class PartsError extends Error {}

export const partOk = (id, len, text) => typeof text === 'string' && text.length === len && hash64(text) === id;

/** The whole text from a manifest and its pieces; throws when one is missing or damaged. */
export function assemble(m, get) {
  const out = [];
  for (let i = 0; i < m.p.length; i++) {
    const t = get(m.p[i]);
    if (t === undefined) throw new PartsError(`A piece of ${m.key} is missing (${i + 1} of ${m.p.length})`);
    if (!partOk(m.p[i], m.n[i], t)) throw new PartsError(`A piece of ${m.key} is damaged (${i + 1} of ${m.p.length})`);
    out.push(t);
  }
  const text = out.join('');
  if (text.length !== m.len) throw new PartsError(`The pieces of ${m.key} don't add up`);
  return text;
}

const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
/** The same data gives the same text, whatever order its fields were written in (Life's appSync canonical). */
export const canonical = (x) => JSON.stringify(x, (_k, v) => (isPlain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
