// Daily backups of Money on your own server. Every night (the morning cron,
// api/cron.mjs) the whole stored copy is saved, compressed, in sys_money_backups
// (a sys_ table: /api/db can't touch it). The last 30 days are kept, plus the
// copies taken right before a restore. Restoring puts a backup back as the
// shared copy with a new `restore` mark, so every device takes it on its next
// sync (js/cloud.js: it backs itself up first).

import { gzipSync, gunzipSync } from 'node:zlib'
import { run } from './_lib.mjs'
import { readValue, readRaw, writeValue, wholeText } from './_money.mjs'

const T = 'CREATE TABLE IF NOT EXISTS sys_money_backups (id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, idx))'
const TI = 'CREATE TABLE IF NOT EXISTS sys_money_backup_info (id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, records INTEGER NOT NULL, chars INTEGER NOT NULL, size INTEGER NOT NULL)'
const CHUNK = 600_000 // characters of base64 per row (well under a request's size)
export const KEEP_DAYS = 30

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null } catch { return null } }

/** The calendar day in Moldova. */
const dayOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Chisinau', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

/**
 * Saves the current server copy. kind: 'daily' (one per day: a second one that day
 * replaces it) | 'manual' | 'before-restore'. Returns the backup's info, or null when
 * there is nothing to save yet.
 */
export async function makeBackup(cfg, { kind = 'daily', now = Date.now(), fetchImpl = fetch } = {}) {
  const { raw } = await readRaw(cfg, fetchImpl)
  if (raw == null) return null
  const text = await wholeText(cfg, raw, fetchImpl)
  const value = parse(text)
  if (!value?.data) return null
  const id = kind === 'daily' ? dayOf(now) : `${dayOf(now)}-${kind}-${now.toString(36)}`
  const b64 = gzipSync(Buffer.from(text, 'utf8')).toString('base64')
  const rows = []
  for (let i = 0; i * CHUNK < b64.length; i++) rows.push(['INSERT INTO sys_money_backups (id, idx, data) VALUES (?, ?, ?)', [id, i, b64.slice(i * CHUNK, (i + 1) * CHUNK)]])
  const info = { id, at: now, kind, records: (value.data.tx || []).length, chars: text.length, size: b64.length }
  // The pieces first (a few per request), the info row last: a backup is listed only once it is whole.
  await run(cfg, [[T], [TI], ['DELETE FROM sys_money_backup_info WHERE id = ?', [id]], ['DELETE FROM sys_money_backups WHERE id = ?', [id]]], fetchImpl)
  for (let i = 0; i < rows.length; i += 2) await run(cfg, rows.slice(i, i + 2), fetchImpl)
  await run(cfg, [['INSERT INTO sys_money_backup_info (id, at, kind, records, chars, size) VALUES (?, ?, ?, ?, ?, ?)', [id, now, kind, info.records, info.chars, info.size]]], fetchImpl)
  await pruneBackups(cfg, { now, fetchImpl })
  return info
}

/** Keeps the last KEEP_DAYS days of backups (daily, manual and before-restore alike). */
export async function pruneBackups(cfg, { now = Date.now(), fetchImpl = fetch } = {}) {
  const cutoff = now - KEEP_DAYS * 86400_000
  await run(cfg, [[T], [TI],
    ['DELETE FROM sys_money_backups WHERE id IN (SELECT id FROM sys_money_backup_info WHERE at < ?)', [cutoff]],
    ['DELETE FROM sys_money_backup_info WHERE at < ?', [cutoff]],
  ], fetchImpl)
}

/** All backups, newest first. */
export async function listBackups(cfg, fetchImpl = fetch) {
  const [, , rows] = await run(cfg, [[T], [TI], ['SELECT id, at, kind, records, chars, size FROM sys_money_backup_info ORDER BY at DESC LIMIT 100']], fetchImpl)
  return rows.map(([id, at, kind, records, chars, size]) => ({ id: String(id), at: Number(at), kind: String(kind), records: Number(records), chars: Number(chars), size: Number(size) }))
}

/** A backup's whole text, or null. */
export async function readBackup(cfg, id, fetchImpl = fetch) {
  const [, rows] = await run(cfg, [[T], ['SELECT data FROM sys_money_backups WHERE id = ? ORDER BY idx', [String(id)]]], fetchImpl)
  if (!rows.length) return null
  return gunzipSync(Buffer.from(rows.map((r) => String(r[0])).join(''), 'base64')).toString('utf8')
}

/**
 * Puts a backup back: first a backup of how things are now (so this can be undone by
 * restoring that one), then the backup becomes the shared copy with a new restore mark.
 */
export async function restoreBackup(cfg, id, { now = Date.now(), fetchImpl = fetch } = {}) {
  const text = await readBackup(cfg, id, fetchImpl)
  const old = parse(text)
  if (!old?.data) throw new Error('That backup is gone or damaged')
  const before = await makeBackup(cfg, { kind: 'before-restore', now, fetchImpl })
  const cur = await readValue(cfg, fetchImpl)
  const mark = `restore-${now.toString(36)}`
  const next = JSON.stringify({ savedAt: now, editedAt: now, data: old.data, restore: mark })
  await writeValue(cfg, next, cur.raw, now, fetchImpl)
  return { restored: id, records: (old.data.tx || []).length, before: before?.id || null, restore: mark }
}
