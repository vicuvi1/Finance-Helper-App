// Your own fields (#1): "Project", "Client", "Receipt no."… Pure; tested
// (web/financeFields.test.ts).
//
// Definitions live in the settings key `customFields` (a settings key travels
// with the sync; the newer settings win, like saved searches):
//   { id, name, type: 'text' | 'number' | 'date' | 'bool' | 'pick',
//     options: [..] (pick-list), kinds: ['expense', 'income', 'transfer'],
//     def (optional default), archived, updatedAt }
// Values live on the record: `fields: { [id]: value }` (text and pick-list:
// a string, number: a number, date: "YYYY-MM-DD", yes/no: true / false).
// Removing a field only archives it: values on records are never deleted, and
// a record keeps values of fields it does not show (an archived field, a field
// for another kind) when it is edited.

export const FIELD_TYPES = [
  { id: 'text', name: 'Text' },
  { id: 'number', name: 'Number' },
  { id: 'date', name: 'Date' },
  { id: 'bool', name: 'Yes / no' },
  { id: 'pick', name: 'Pick-list' },
];
export const KINDS = [
  { id: 'expense', name: 'Spent' },
  { id: 'income', name: 'Earned' },
  { id: 'transfer', name: 'Move' },
];
export const MAX_FIELDS = 20;

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const keyOf = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, '');
const TYPE_IDS = new Set(FIELD_TYPES.map((x) => x.id));
const KIND_IDS = KINDS.map((x) => x.id);

const validDef = (d) => d && typeof d.id === 'string' && d.id && typeof d.name === 'string' && d.name.trim() && TYPE_IDS.has(d.type);

/** Your fields (archived ones only with `all`). */
export function fieldDefs(state, { all = false } = {}) {
  const list = Array.isArray(state?.settings?.customFields) ? state.settings.customFields.filter(validDef) : [];
  return all ? list : list.filter((d) => !d.archived);
}
export const fieldById = (state, id) => fieldDefs(state, { all: true }).find((d) => d.id === id) || null;
const kindsOf = (d) => (Array.isArray(d.kinds) && d.kinds.length ? d.kinds.filter((k) => KIND_IDS.includes(k)) : ['expense', 'income']);
/** The fields a record of this type shows. */
export const defsFor = (state, type) => fieldDefs(state).filter((d) => kindsOf(d).includes(type));

/** "1 234,5" -> 1234.5; null when it is not a number. */
function toNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? '').replace(/[\s ]/g, '');
  if (!s) return null;
  const v = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/**
 * A typed or imported value made right for the field: { ok, value }. An empty
 * value is { ok: true, value: undefined } (no value). A pick-list value must be
 * one of its options (any letter case; the option's own spelling is kept).
 */
export function coerce(def, raw) {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return { ok: true, value: undefined };
  if (def.type === 'text') return { ok: true, value: String(raw).trim().slice(0, 200) };
  if (def.type === 'number') { const v = toNumber(raw); return v == null ? { ok: false, value: undefined } : { ok: true, value: v }; }
  if (def.type === 'date') { const s = String(raw).trim().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { ok: true, value: s } : { ok: false, value: undefined }; }
  if (def.type === 'bool') {
    if (raw === true || raw === false) return { ok: true, value: raw };
    const s = fold(raw).trim();
    if (['yes', 'y', 'true', '1', 'da', 'on', 'x'].includes(s)) return { ok: true, value: true };
    if (['no', 'n', 'false', '0', 'nu', 'off'].includes(s)) return { ok: true, value: false };
    return { ok: false, value: undefined };
  }
  if (def.type === 'pick') {
    const hit = (def.options || []).find((o) => fold(o) === fold(String(raw).trim()));
    return hit != null ? { ok: true, value: hit } : { ok: false, value: undefined };
  }
  return { ok: false, value: undefined };
}

/** The value as text ("Yes", "12.5", "2026-11-18", "Website"); '' when none. */
export function display(def, v) {
  if (v === undefined || v === null || v === '') return '';
  if (def?.type === 'bool') return v ? 'Yes' : 'No';
  return String(v);
}

export const valueOf = (t, id) => (t?.fields && typeof t.fields === 'object' ? t.fields[id] : undefined);

/** Sets (or, with undefined, removes) one value on a record, in place. Returns true when it changed. */
export function setValue(t, id, value) {
  const before = valueOf(t, id);
  if (before === value) return false;
  const next = { ...(t.fields && typeof t.fields === 'object' ? t.fields : {}) };
  if (value === undefined) delete next[id]; else next[id] = value;
  if (Object.keys(next).length) t.fields = next; else delete t.fields;
  return true;
}

/** Default values for a new record of this type: { id: value }. */
export function defaultsFor(state, type) {
  const out = {};
  for (const d of defsFor(state, type)) {
    const c = d.def === undefined ? null : coerce(d, d.def);
    if (c?.ok && c.value !== undefined) out[d.id] = c.value;
  }
  return out;
}

const stamp = (state, now) => { state.settings.updatedAt = now; };

/** Check a definition from the editor: '' when fine, else what is wrong. */
export function problem(state, d, { id = null } = {}) {
  const name = String(d?.name || '').trim();
  if (!name) return 'Give the field a name';
  if (name.length > 30) return 'Keep the name under 30 letters';
  if (!TYPE_IDS.has(d.type)) return 'Pick a type';
  if (fieldDefs(state, { all: true }).some((x) => x.id !== id && !x.archived && keyOf(x.name) === keyOf(name))) return 'You already have a field with this name';
  if (d.type === 'pick' && !(cleanOptions(d.options).length)) return 'Add at least one option';
  if (!(Array.isArray(d.kinds) && d.kinds.some((k) => KIND_IDS.includes(k)))) return 'Tick at least one kind of record';
  if (d.def !== undefined && d.def !== '' && !coerce({ ...d, options: cleanOptions(d.options) }, d.def).ok) return 'The default does not fit the type';
  return '';
}

export function cleanOptions(opts) {
  const list = (Array.isArray(opts) ? opts : String(opts || '').split(/[,\n]/)).map((o) => String(o).trim()).filter(Boolean);
  const out = [];
  for (const o of list) if (!out.some((x) => fold(x) === fold(o))) out.push(o.slice(0, 40));
  return out.slice(0, 50);
}

function shape(d) {
  const out = { name: String(d.name).trim(), type: d.type, kinds: KIND_IDS.filter((k) => d.kinds.includes(k)) };
  if (d.type === 'pick') out.options = cleanOptions(d.options);
  const c = d.def === undefined || d.def === '' ? null : coerce(out, d.def);
  if (c?.ok && c.value !== undefined) out.def = c.value;
  return out;
}

/** Adds a field. Returns { def } or { error }. */
export function addField(state, d, now = Date.now()) {
  const err = problem(state, d);
  if (err) return { error: err };
  if (fieldDefs(state).length >= MAX_FIELDS) return { error: `At most ${MAX_FIELDS} fields` };
  const base = keyOf(d.name).slice(0, 16) || 'field';
  let id = `f-${base}`;
  for (let n = 2; fieldDefs(state, { all: true }).some((x) => x.id === id); n++) id = `f-${base}-${n}`;
  const def = { id, ...shape(d), updatedAt: now };
  state.settings.customFields = [...fieldDefs(state, { all: true }), def];
  stamp(state, now);
  return { def };
}

/** Changes a field (its id and the values on records stay). Returns { def } or { error }. */
export function updateField(state, id, d, now = Date.now()) {
  const cur = fieldById(state, id);
  if (!cur) return { error: 'That field is gone' };
  const err = problem(state, d, { id });
  if (err) return { error: err };
  const def = { ...cur, ...shape(d), updatedAt: now };
  if (def.type !== 'pick') delete def.options;
  if (shape(d).def === undefined) delete def.def;
  state.settings.customFields = fieldDefs(state, { all: true }).map((x) => (x.id === id ? def : x));
  stamp(state, now);
  return { def };
}

/** Archive (or bring back) a field. Values on records are kept either way. */
export function archiveField(state, id, archived = true, now = Date.now()) {
  if (!fieldById(state, id)) return false;
  state.settings.customFields = fieldDefs(state, { all: true }).map((x) => (x.id === id ? { ...x, archived: !!archived, updatedAt: now } : x));
  stamp(state, now);
  return true;
}

/** How many records have a value for this field. */
export const usedBy = (state, id) => (state.tx || []).filter((t) => valueOf(t, id) !== undefined).length;

// ---------- Search ("project:website", "paid:yes", "receiptno:12") ----------

/** The field a "name:" word means (its name with spaces and dots left out, or the start of it). */
export function fieldForKey(state, key) {
  const k = keyOf(key);
  if (!k) return null;
  const all = fieldDefs(state, { all: true });
  return all.find((d) => keyOf(d.name) === k) || all.find((d) => keyOf(d.name).startsWith(k)) || all.find((d) => fold(d.name).split(/\s+/)[0] === k) || null;
}

/** Does this record's value match what was typed after "name:"? */
export function valueMatches(def, v, typed) {
  const want = fold(typed).trim();
  if (def.type === 'bool' && (v === undefined || v === null)) v = false; // no tick = no
  if (v === undefined || v === null || v === '') return want === '-' || want === 'none' || want === 'empty';
  if (!want) return true;
  if (def.type === 'bool') return (want === 'yes' || want === 'true' || want === 'da') === !!v && ['yes', 'true', 'da', 'no', 'false', 'nu'].includes(want);
  if (def.type === 'number') {
    const m = want.match(/^(>=?|<=?)?(-?\d+(?:[.,]\d+)?)$/);
    if (!m) return false;
    const x = Number(m[2].replace(',', '.'));
    return m[1] === '>' ? v > x : m[1] === '>=' ? v >= x : m[1] === '<' ? v < x : m[1] === '<=' ? v <= x : v === x;
  }
  if (def.type === 'date') return String(v).startsWith(want);
  return fold(v).includes(want);
}

/**
 * Splits the plain words of a search into field filters and the other words.
 * A word "name:value" whose name is one of your fields becomes a filter.
 */
export function fieldFilters(state, words) {
  const filters = [];
  const rest = [];
  for (const w of words || []) {
    const m = String(w).match(/^([^:]+):(.*)$/);
    const def = m && fieldForKey(state, m[1]);
    if (def) filters.push({ def, value: m[2] });
    else rest.push(w);
  }
  return { filters, words: rest };
}

export const matchesFilters = (t, filters) => filters.every((f) => valueMatches(f.def, valueOf(t, f.def.id), f.value));

// ---------- Export and import ----------

/** The column header of a field in the export: "Field: Project". */
export const columnName = (d) => `Field: ${d.name}`;

/** The fields that get an export column: every field you have, and archived ones still holding values. */
export function exportDefs(state, list = state.tx) {
  return fieldDefs(state, { all: true }).filter((d) => !d.archived || (list || []).some((t) => valueOf(t, d.id) !== undefined));
}

/** A value as an export cell. */
export function cellOf(d, v) {
  if (v === undefined || v === null) return '';
  if (d.type === 'bool') return v ? 'yes' : 'no';
  return String(v);
}

/**
 * Reads "Field: X" columns of an import row into `fields`. `get(name)` gives
 * the cell. A field that is not here, or a value that does not fit, stays in
 * the "Other fields" copy only (nothing is lost). Returns { fields, bad }.
 */
export function readImportFields(state, header, get, fields = {}) {
  const out = { ...(fields && typeof fields === 'object' ? fields : {}) };
  const bad = [];
  for (const h of header) {
    const m = String(h).match(/^field:\s*(.+)$/i);
    if (!m) continue;
    const def = fieldDefs(state, { all: true }).find((d) => fold(d.name) === fold(m[1].trim()));
    if (!def) continue;
    const cell = get(h);
    if (cell === '') continue;
    const c = coerce(def, cell);
    if (c.ok && c.value !== undefined) out[def.id] = c.value;
    else bad.push(def.name);
  }
  return { fields: out, bad };
}

// ---------- Log columns (shown or hidden, per device) ----------

/** The fields shown as Log Table columns: `shown` is the list of ids you turned on. */
export const shownColumns = (state, shown) => fieldDefs(state).filter((d) => (shown || []).includes(d.id));
