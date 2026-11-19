// The daily cloud backups (cloud_snapshots, 30 kept) outside the page's reach
// (LT1). Pages may only READ them through /api/db (_sqlguard.mjs); the app's
// daily backup is added here, and the weekly off-site copy (GitHub Actions,
// .github/workflows/backup.yml) downloads the newest one with CRON_SECRET.
//
// No size ceiling (2026-11-12): a backup is one gzip stream cut into parts
// (src/core/backupPack.ts). Each part is one row of cloud_snapshot_parts (one
// request each, at most CHUNK_MAX); the day's cloud_snapshots row holds the
// manifest ("parts:" + JSON) and is written last, so a backup only counts once
// every part is in and checked. Old one-piece backups still read and save.
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { run } from './_lib.mjs'

export const SNAPSHOTS_TABLE = 'CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)'
export const PARTS_TABLE = 'CREATE TABLE IF NOT EXISTS cloud_snapshot_parts (day TEXT NOT NULL, part INTEGER NOT NULL, size_bytes INTEGER, sha TEXT, data TEXT, PRIMARY KEY (day, part))'
/** What one stored chunk may be (one request to Vercel carries at most 4.5 MB). */
export const MAX = 4_200_000
export const MAX_PARTS = 2000
const DAY_MS = 86400_000
const KEEP_DAYS = 31
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const B64 = /^[A-Za-z0-9+/=]+$/

/** The manifest of a parts backup, or null (an old one-piece backup, or not valid). */
export function manifestOf(data) {
  if (typeof data !== 'string' || !data.startsWith('parts:')) return null
  try {
    const m = JSON.parse(data.slice(6))
    if (m?.v !== 3 || !Number.isInteger(m.parts) || m.parts < 1 || m.parts > MAX_PARTS || !Array.isArray(m.shas) || m.shas.length !== m.parts || !/^[0-9a-f]{64}$/.test(String(m.sha))) return null
    return m
  } catch {
    return null
  }
}

const dayProblem = (day, now) => {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Bad day'
  if (day < isoDay(now - DAY_MS) || day > isoDay(now + DAY_MS)) return 'A backup can only be saved for today'
  return null
}

/** Why a backup from the app is refused, or null. `day` must be today (± 1 day for time zones). */
export function snapshotProblem(snap, now = Date.now()) {
  if (!snap || typeof snap !== 'object') return 'Expected {snapshot: {day, data}}'
  const { day, data } = snap
  const bad = dayProblem(day, now)
  if (bad) return bad
  if (typeof data !== 'string' || !data) return 'Empty backup'
  if (data.startsWith('parts:')) return manifestOf(data) ? null : 'Not a backup'
  if (data.length > MAX) return 'This backup is too big for one piece: send it in parts'
  if (!(data.startsWith('gz:') ? B64.test(data.slice(3, 4096)) : data.trimStart().startsWith('{'))) return 'Not a backup'
  return null
}

/** Why one part of a backup is refused, or null. Its checksum must match its bytes. */
export function partProblem(p, now = Date.now()) {
  if (!p || typeof p !== 'object') return 'Expected {snapshotPart: {day, part, data, sha}}'
  const bad = dayProblem(p.day, now)
  if (bad) return bad
  if (!Number.isInteger(p.part) || p.part < 0 || p.part >= MAX_PARTS) return 'Bad part number'
  if (typeof p.data !== 'string' || !p.data || p.data.length > MAX || !B64.test(p.data)) return 'Bad part'
  if (typeof p.sha !== 'string' || sha256(Buffer.from(p.data, 'base64')) !== p.sha) return 'The part does not match its checksum'
  return null
}

/** Stores one part of today's backup. A day whose backup is complete never changes again. */
export async function saveSnapshotPart(cfg, p, now = Date.now(), fetchImpl = fetch) {
  const problem = partProblem(p, now)
  if (problem) return { status: 400, body: { error: problem } }
  try {
    const [, , ins] = await run(
      cfg,
      [
        [SNAPSHOTS_TABLE],
        [PARTS_TABLE],
        [
          'INSERT INTO cloud_snapshot_parts (day, part, size_bytes, sha, data) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM cloud_snapshots WHERE day = ?) ON CONFLICT(day, part) DO UPDATE SET size_bytes = excluded.size_bytes, sha = excluded.sha, data = excluded.data RETURNING part',
          [p.day, p.part, p.data.length, p.sha, p.data, p.day]
        ]
      ],
      fetchImpl
    )
    return { status: 200, body: { ok: true, saved: ins.length > 0 } }
  } catch (e) {
    return { status: 503, body: { error: e.message || 'Database not reachable' } }
  }
}

/** Adds today's backup when there is none yet (never overwrites one) and drops those older than 30 days. A parts backup must have every part in, each matching the manifest. */
export async function saveSnapshot(cfg, snap, now = Date.now(), fetchImpl = fetch) {
  const problem = snapshotProblem(snap, now)
  if (problem) return { status: 400, body: { error: problem } }
  try {
    const m = manifestOf(snap.data)
    let size = Buffer.byteLength(snap.data)
    if (m) {
      const [, , parts] = await run(cfg, [[SNAPSHOTS_TABLE], [PARTS_TABLE], ['SELECT part, sha, size_bytes FROM cloud_snapshot_parts WHERE day = ? ORDER BY part', [snap.day]]], fetchImpl)
      const have = new Map(parts.map(([part, sha]) => [Number(part), String(sha)]))
      for (let i = 0; i < m.parts; i++) if (have.get(i) !== m.shas[i]) return { status: 409, body: { error: `Part ${i + 1} of ${m.parts} is missing or different: send it again` } }
      size = parts.filter(([part]) => Number(part) < m.parts).reduce((n, [, , s]) => n + Number(s || 0), 0)
    }
    const cut = isoDay(now - KEEP_DAYS * DAY_MS)
    const [, , ins] = await run(
      cfg,
      [
        [SNAPSHOTS_TABLE],
        [PARTS_TABLE],
        ['INSERT INTO cloud_snapshots (day, exported_at, size_bytes, data) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO NOTHING RETURNING day', [snap.day, new Date(now).toISOString(), size, snap.data]],
        ['DELETE FROM cloud_snapshots WHERE day < ?', [cut]],
        ['DELETE FROM cloud_snapshot_parts WHERE day < ?', [cut]],
        // Parts beyond the manifest (an earlier, longer try of the same day) are not part of the backup.
        ...(m ? [['DELETE FROM cloud_snapshot_parts WHERE day = ? AND part >= ? AND NOT EXISTS (SELECT 1 FROM cloud_snapshots WHERE day = ? AND data != ?)', [snap.day, m.parts, snap.day, snap.data]]] : [])
      ],
      fetchImpl
    )
    return { status: 200, body: { ok: true, saved: ins.length > 0 } }
  } catch (e) {
    return { status: 503, body: { error: e.message || 'Database not reachable' } }
  }
}

/** The newest backup's day and parts list (for the off-site copy), or null when there is none. */
export async function newestSnapshotInfo(cfg, fetchImpl = fetch) {
  const [, , rows] = await run(cfg, [[SNAPSHOTS_TABLE], [PARTS_TABLE], ['SELECT day, data, size_bytes FROM cloud_snapshots ORDER BY day DESC LIMIT 1']], fetchImpl)
  if (!rows.length) return null
  const [day, data] = rows[0]
  const m = manifestOf(String(data ?? ''))
  if (m) return { day: String(day), parts: m.parts, bytes: m.bytes, sha: m.sha, shas: m.shas }
  // An old one-piece backup is one part.
  const gz = onePiece(String(data ?? ''))
  return { day: String(day), parts: 1, bytes: gz.length, sha: sha256(gz), shas: [sha256(gz)] }
}

const onePiece = (raw) => (raw.startsWith('gz:') ? Buffer.from(raw.slice(3), 'base64') : gzipSync(Buffer.from(raw, 'utf8')))

/** One part of a day's backup as gzip bytes (an old one-piece backup is part 0), or null. */
export async function snapshotPart(cfg, day, part, fetchImpl = fetch) {
  const [, , rows] = await run(cfg, [[SNAPSHOTS_TABLE], [PARTS_TABLE], ['SELECT data FROM cloud_snapshots WHERE day = ?', [day]]], fetchImpl)
  if (!rows.length) return null
  const data = String(rows[0][0] ?? '')
  const m = manifestOf(data)
  if (!m) return part === 0 ? onePiece(data) : null
  if (!(part >= 0 && part < m.parts)) return null
  const [p] = await run(cfg, [['SELECT data, sha FROM cloud_snapshot_parts WHERE day = ? AND part = ?', [day, part]]], fetchImpl)
  if (!p.length) return null
  const buf = Buffer.from(String(p[0][0]), 'base64')
  if (sha256(buf) !== m.shas[part]) throw new Error(`Part ${part + 1} of the ${day} backup does not match its checksum`)
  return buf
}

/** The newest backup as gzip bytes (all its parts joined and checked), or null when there is none. */
export async function newestSnapshot(cfg, fetchImpl = fetch) {
  const info = await newestSnapshotInfo(cfg, fetchImpl)
  if (!info) return null
  const parts = []
  for (let i = 0; i < info.parts; i++) {
    const p = await snapshotPart(cfg, info.day, i, fetchImpl)
    if (!p) throw new Error(`Part ${i + 1} of the ${info.day} backup is missing`)
    parts.push(p)
  }
  const gz = Buffer.concat(parts)
  if (sha256(gz) !== info.sha) throw new Error(`The ${info.day} backup does not match its checksum`)
  return { day: info.day, gz }
}
