// Money's copy on the server, read and written in exactly the format Life
// System uses (settings.app_sync_finance = {savedAt, editedAt, data}, a big
// value as a manifest plus pieces in setting_parts: js/parts.js), so the data
// already in the database reads as it is and Life System's own apps still
// read what this app writes.
//
// The merge runs HERE, with the app's own merge (js/sync.js: the newer edit of
// each record wins, deletions stick through tombstones, nothing else is ever
// removed). A device sends its whole shared copy; the server merges it with
// the stored copy inside a compare-and-set transaction (tried again when
// another device wrote first) and answers with the stored value, so the
// device knows the server holds everything it has (confirmed synced).
//
// Request bodies stay far below Vercel's 4.5 MB: a big copy goes up as pieces
// first ({op:'upload'}) and is then named by its manifest; a big stored value
// comes back as a manifest whose pieces the device fetches ({op:'parts'}).
import { randomBytes } from 'node:crypto'
import { turso, run } from './_lib.mjs'
import { mergeStates, toCloud } from '../js/sync.js'
import { normalizeState, SCHEMA_VERSION } from '../js/model.js'
import { PARTS_DDL, PARTS_OK_TABLE, PARTS_TABLE, WHOLE_UP_TO, assemble, canonical, hash64, looksLikeManifest, manifestOf, parseManifest, PartsError } from '../js/parts.js'

export const KEY = 'app_sync_finance'
export const SEALED_KEY = 'app_sync_finance_sealed'
export const LEGACY_KEY = 'finance_backup_json'
/** One server→database request carries at most this many characters of pieces. */
const BATCH_CHARS = 900_000
/** One answer to a device carries at most this many characters (pieces or a slice). */
export const ANSWER_CHARS = 2_500_000
/** An old piece is cleaned up only when at least this old (a reader or writer may still use it). */
const GRACE_MS = 10 * 60_000

const parse = (raw) => {
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}
/** What travels: Money without the device-only parts (Life's financeSync share). */
export const share = (state) => toCloud(normalizeState({ ...state, version: SCHEMA_VERSION }), '').data
const fromShared = (data) => normalizeState({ ...data, version: SCHEMA_VERSION })
const remote = (data) => ({ app: 'finance-helper', schema: SCHEMA_VERSION, savedAt: 0, data })
/** Both copies merged by the app's own rules (the stored copy is `base`). */
export const mergeShared = (base, incoming) => (base ? share(mergeStates(fromShared(base), remote(incoming)).state) : share(fromShared(incoming)))

const hv = (v) => (v == null ? { type: 'null' } : typeof v === 'number' ? { type: 'integer', value: String(Math.round(v)) } : { type: 'text', value: String(v) })

/** Statements in one transaction (all or nothing), like Life's TursoHttp.writeAtomic. */
export async function atomic(cfg, stmts, fetchImpl = fetch) {
  const steps = [{ stmt: { sql: 'BEGIN' } }]
  stmts.forEach(([sql, args = []], i) => steps.push({ condition: { type: 'ok', step: i }, stmt: { sql, args: args.map(hv) } }))
  const last = steps.length - 1
  steps.push({ condition: { type: 'ok', step: last }, stmt: { sql: 'COMMIT' } })
  steps.push({ condition: { type: 'not', cond: { type: 'ok', step: last + 1 } }, stmt: { sql: 'ROLLBACK' } })
  const { status, json } = await turso(cfg, { requests: [{ type: 'batch', batch: { steps } }, { type: 'close' }] }, fetchImpl)
  if (status !== 200) throw new Error('Database not reachable')
  const r = json?.results?.[0]
  if (!r || r.type === 'error') throw new Error(r?.error?.message || 'Database not reachable')
  const res = r.response?.result
  if (res?.step_results?.[last + 1] == null) {
    const err = (res?.step_errors ?? []).find(Boolean)
    throw new Error(err?.message || 'The database did not save the change')
  }
  return res
}

/** The stored value as it is (a manifest or the whole text), and whether a sealed (PIN-locked) copy exists. */
export async function readRaw(cfg, fetchImpl = fetch) {
  const [rows, sealedRows] = await run(cfg, [['SELECT value FROM settings WHERE key = ?', [KEY]], ['SELECT value FROM settings WHERE key = ?', [SEALED_KEY]]], fetchImpl)
  const raw = rows[0]?.[0] ?? null
  const sealed = parse(sealedRows[0]?.[0])
  return { raw: raw == null ? null : String(raw), sealed: !!(sealed && !sealed.retired && sealed.box) }
}

/** Pieces of this key by id ({id: text}); missing ones are left out. */
export async function readParts(cfg, ids, fetchImpl = fetch) {
  const out = {}
  const list = [...new Set(ids)].filter((x) => /^[0-9a-f]{16}$/.test(x))
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40)
    let rows
    try {
      ;[rows] = await run(cfg, [[`SELECT id, data FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))`, [KEY, JSON.stringify(chunk)]]], fetchImpl)
    } catch (e) {
      if (/no such table/i.test(String(e?.message))) return out
      throw e
    }
    for (const [id, data] of rows) out[String(id)] = String(data)
  }
  return out
}

/** The whole text of a stored value (a manifest is put back together). */
export async function wholeText(cfg, raw, fetchImpl = fetch) {
  const m = parseManifest(raw)
  if (!m) return raw
  const got = await readParts(cfg, m.p, fetchImpl)
  return assemble(m, (id) => got[id])
}

/** The stored copy ({savedAt, editedAt, data, restore?}) or null; Life's old backup when there is no copy yet. */
export async function readValue(cfg, fetchImpl = fetch) {
  const { raw, sealed } = await readRaw(cfg, fetchImpl)
  if (raw != null) return { raw, sealed, value: parse(await wholeText(cfg, raw, fetchImpl)) }
  const [legacy] = await run(cfg, [['SELECT value FROM settings WHERE key = ?', [LEGACY_KEY]]], fetchImpl)
  const old = parse(legacy[0]?.[0])
  return { raw: null, sealed, value: old && Array.isArray(old.tx) ? { savedAt: 0, data: share(old) } : null }
}

/** Uploads pieces of this key (each checked against its name). Pieces already there only get a new time. */
export async function uploadParts(cfg, parts, now = Date.now(), fetchImpl = fetch) {
  const good = []
  for (const p of parts || []) {
    if (!p || typeof p.id !== 'string' || typeof p.text !== 'string' || hash64(p.text) !== p.id) throw new PartsError('A piece does not match its name')
    good.push(p)
  }
  let batch = []
  let size = 0
  const flush = async () => {
    if (!batch.length) return
    await atomic(cfg, [...PARTS_DDL.map((sql) => [sql]), ...batch], fetchImpl)
    batch = []
    size = 0
  }
  for (const p of good) {
    if (batch.length && size + p.text.length > BATCH_CHARS) await flush()
    batch.push([`INSERT INTO ${PARTS_TABLE} (key, id, data, at) VALUES (?, ?, ?, ?) ON CONFLICT(key, id) DO UPDATE SET at = excluded.at`, [KEY, p.id, p.text, now]])
    size += p.text.length
  }
  await flush()
  return good.length
}

/** Which of these piece ids the server already has. */
export async function hasParts(cfg, ids, fetchImpl = fetch) {
  const list = [...new Set(ids || [])].filter((x) => /^[0-9a-f]{16}$/.test(x))
  if (!list.length) return []
  try {
    const [rows] = await run(cfg, [[`SELECT id FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))`, [KEY, JSON.stringify(list)]]], fetchImpl)
    return rows.map((r) => String(r[0]))
  } catch (e) {
    if (/no such table/i.test(String(e?.message))) return []
    throw e
  }
}

const isConflict = (e) => /sys_cas|CHECK constraint failed|ok = 1|parts_ok/i.test(String(e?.message ?? e))

/** "Still what I read?": the manifest itself, or a whole value told by its length and both ends (Life's chunked CAS). */
const casStmt = (raw) => (raw == null
  ? ['INSERT INTO sys_cas (ok) VALUES ((SELECT COUNT(*) FROM settings WHERE key = ?) = 0)', [KEY]]
  : ['INSERT INTO sys_cas (ok) VALUES (COALESCE((SELECT (value = ?) OR (length(value) = ? AND substr(value, 1, 96) = ? AND substr(value, -96) = ?) FROM settings WHERE key = ?), 0))', [raw, raw.length, raw.slice(0, 96), raw.slice(-96), KEY]])

/**
 * Writes `text` as the new stored value, only if the stored value is still
 * `expectRaw`. A big text goes as pieces (uploaded first) plus its manifest.
 * Every other Life device sees the change (data_version and the settings table's version move on).
 */
export async function writeValue(cfg, text, expectRaw, now = Date.now(), fetchImpl = fetch) {
  const big = text.length > WHOLE_UP_TO
  const enc = big ? manifestOf(KEY, text) : null
  if (big) {
    const there = new Set(await hasParts(cfg, enc.parts.map((p) => p.id), fetchImpl))
    await uploadParts(cfg, enc.parts.filter((p, i, all) => !there.has(p.id) && all.findIndex((q) => q.id === p.id) === i), now, fetchImpl)
  }
  const stored = big ? enc.manifest : text
  const version = `${now.toString(36)}-${randomBytes(4).toString('hex')}`
  const ids = big ? JSON.stringify([...new Set(enc.parts.map((p) => p.id))]) : '[]'
  const stmts = [
    ...PARTS_DDL.map((sql) => [sql]),
    ['CREATE TABLE IF NOT EXISTS sys_cas (ok INTEGER NOT NULL CHECK (ok = 1))'],
    casStmt(expectRaw),
    ...(big ? [[`INSERT INTO ${PARTS_OK_TABLE} (parts_ok) VALUES ((SELECT COUNT(*) FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))) = ?)`, [KEY, ids, new Set(enc.parts.map((p) => p.id)).size]]] : []),
    ['INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [KEY, stored]],
    [`DELETE FROM ${PARTS_TABLE} WHERE key = ? AND at < ? AND id NOT IN (SELECT value FROM json_each(?))`, [KEY, now - GRACE_MS, ids]],
    // Life's change tracking (src/renderer/src/web/tableVersions.ts trackStatements), then data_version.
    ['CREATE TABLE IF NOT EXISTS sys_table_versions (name TEXT PRIMARY KEY, v TEXT NOT NULL)'],
    ["INSERT INTO sys_table_versions (name, v) SELECT '*', ? WHERE COALESCE((SELECT value FROM settings WHERE key = 'data_version'), '') = COALESCE((SELECT v FROM sys_table_versions WHERE name = '*'), '') ON CONFLICT(name) DO UPDATE SET v = excluded.v", [version]],
    ["INSERT INTO sys_table_versions (name, v) VALUES ('settings', ?) ON CONFLICT(name) DO UPDATE SET v = excluded.v", [version]],
    ["INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [version]],
    ['DELETE FROM sys_cas'],
    [`DELETE FROM ${PARTS_OK_TABLE}`],
  ]
  await atomic(cfg, stmts, fetchImpl)
  return stored
}

/**
 * A device's shared copy merged into the stored one. `edited`: the device
 * changed Money since it last agreed (its edit time `editedAt`), so the
 * written copy carries a new edit time; else the stored copy's time stays.
 * Returns { raw, changed, editedAt, restore }.
 */
export async function pushCopy(cfg, incoming, { edited = false, editedAt = 0 } = {}, now = Date.now(), fetchImpl = fetch) {
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.tx)) throw new Error('Not a Money copy')
  let last
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readValue(cfg, fetchImpl)
    const theirs = cur.value?.data ?? null
    const theirsAt = Number(cur.value?.editedAt ?? cur.value?.savedAt) || 0
    const data = mergeShared(theirs, incoming)
    if (theirs && cur.raw != null && canonical(data) === canonical(theirs)) {
      return { raw: cur.raw, changed: false, editedAt: theirsAt, restore: cur.value?.restore ?? null, sealed: cur.sealed }
    }
    const at = now + attempt
    const stamp = edited ? Math.max(at, Number(editedAt) || 0, theirsAt + 1) : theirsAt || at
    const restore = cur.value?.restore
    const text = JSON.stringify({ savedAt: at, editedAt: stamp, data, ...(restore ? { restore } : {}) })
    try {
      const raw = await writeValue(cfg, text, cur.raw, at, fetchImpl)
      return { raw, changed: true, editedAt: stamp, restore: restore ?? null, sealed: cur.sealed }
    } catch (e) {
      last = e
      if (!isConflict(e)) throw e
    }
  }
  throw last
}

/**
 * Self-heal (Life's ChunkedTurso.heal): a device holding the whole text of
 * the stored value sends it; when it is exactly what the manifest names, the
 * pieces the server lost are put back. Changes no value.
 */
export async function healCopy(cfg, text, now = Date.now(), fetchImpl = fetch) {
  if (typeof text !== 'string' || text.length <= WHOLE_UP_TO) return { healed: 0 }
  const { raw } = await readRaw(cfg, fetchImpl)
  const enc = manifestOf(KEY, text)
  if (raw !== enc.manifest) return { healed: 0, stale: true }
  const there = new Set(await hasParts(cfg, enc.parts.map((p) => p.id), fetchImpl))
  const todo = enc.parts.filter((p, i, all) => !there.has(p.id) && all.findIndex((q) => q.id === p.id) === i)
  await uploadParts(cfg, todo, now, fetchImpl)
  return { healed: todo.length }
}

/** The device's copy: inline JSON, or a manifest of pieces it uploaded first. */
export async function incomingText(cfg, body, fetchImpl = fetch) {
  if (typeof body.text === 'string') return body.text
  const m = parseManifest(body.manifest)
  if (!m || m.key !== KEY) throw new Error('Expected text or a manifest')
  const got = await readParts(cfg, m.p, fetchImpl)
  return assemble(m, (id) => got[id])
}

/** Slices of a whole stored value, for a value too big for one answer. */
export async function readSlice(cfg, from, fetchImpl = fetch) {
  const start = Math.max(0, Number(from) || 0)
  const [rows] = await run(cfg, [['SELECT substr(value, ?, ?), length(value) FROM settings WHERE key = ?', [start + 1, ANSWER_CHARS, KEY]]], fetchImpl)
  return { slice: rows[0]?.[0] ?? '', len: Number(rows[0]?.[1]) || 0 }
}

export { looksLikeManifest }
