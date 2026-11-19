// Devices (A6): every session carries a device id (sid). Each login records the
// device (a readable label from its browser, first and last use) in a
// server-only table; one device can be signed out on its own, and passkeys
// can be removed one by one. Old sessions without an id keep working until
// the next "sign out everywhere".
import { randomBytes } from 'node:crypto'
import { run } from './_lib.mjs'
import { dropPush } from './_push.mjs'

export const T_DEVICES = 'CREATE TABLE IF NOT EXISTS sys_devices (sid TEXT PRIMARY KEY, label TEXT, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)'
export const newSid = () => randomBytes(9).toString('base64url')

/** "Chrome on Windows", "Safari on iPhone", "Life System app on Windows". */
export function deviceLabel(ua = '') {
  const u = String(ua)
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'a device'
  const app = /Electron|LifeSystem/i.test(u) ? 'Life System app' : /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser'
  return `${app} on ${os}`
}

let revokedCache = { at: 0, set: new Set() }
/** Signed-out device ids (cached 30 s per server instance). */
export async function revokedSids(cfg, fetchImpl = fetch, now = Date.now()) {
  if (now - revokedCache.at < 30_000) return revokedCache.set
  try {
    const [, rows] = await run(cfg, [[T_DEVICES], ['SELECT sid FROM sys_devices WHERE revoked = 1']], fetchImpl)
    revokedCache = { at: now, set: new Set(rows.map((r) => String(r[0]))) }
  } catch {
    /* keep the last list */
  }
  return revokedCache.set
}
export const forgetRevoked = () => (revokedCache = { at: 0, set: new Set() })

const seen = new Map()
/** Records the device on login (and its last use, at most every 10 minutes). */
export async function touchDevice(cfg, sid, ua, now = Date.now(), fetchImpl = fetch) {
  if (!sid || now - (seen.get(sid) ?? 0) < 10 * 60000) return
  seen.set(sid, now)
  await run(cfg, [[T_DEVICES], ['INSERT INTO sys_devices (sid, label, created, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(sid) DO UPDATE SET last_seen = excluded.last_seen', [sid, deviceLabel(ua), now, now]]], fetchImpl).catch(() => null)
}

/** Your devices and passkeys, newest use first. */
export async function listDevices(cfg, fetchImpl = fetch) {
  const [, , devices, keys] = await run(
    cfg,
    [
      [T_DEVICES],
      [T_KEYS_PLAIN],
      ['SELECT sid, label, created, last_seen FROM sys_devices WHERE revoked = 0 ORDER BY last_seen DESC LIMIT 30'],
      ['SELECT id, label, created FROM sys_passkeys ORDER BY created DESC']
    ],
    fetchImpl
  )
  return {
    devices: devices.map(([sid, label, created, last]) => ({ sid: String(sid), label: String(label ?? 'A device'), created: Number(created), lastSeen: Number(last) })),
    passkeys: keys.map(([id, label, created]) => ({ id: String(id), label: String(label ?? 'Passkey'), created: Number(created) }))
  }
}

/** Signs one device out, and removes the passkeys it made (A3). */
export async function revokeDevice(cfg, sid, fetchImpl = fetch) {
  await run(cfg, [[T_DEVICES], ['INSERT INTO sys_devices (sid, label, created, last_seen, revoked) VALUES (?, ?, 0, 0, 1) ON CONFLICT(sid) DO UPDATE SET revoked = 1', [String(sid), 'Signed out']]], fetchImpl)
  await removeDevicePasskeys(cfg, sid, fetchImpl)
  await dropPush(cfg, sid, false, fetchImpl).catch(() => {}) // BG7
  forgetRevoked()
}

/** Passkeys made on that device (or, with `keep`, every passkey except that device's). */
export async function removeDevicePasskeys(cfg, sid, fetchImpl = fetch, keep = false) {
  await run(cfg, [[T_KEYS_PLAIN], [keep ? 'DELETE FROM sys_passkeys WHERE sid IS NOT ?' : 'DELETE FROM sys_passkeys WHERE sid = ?', [sid == null ? null : String(sid)]]], fetchImpl).catch((e) => {
    if (!/no such column/i.test(String(e?.message))) throw e
    // An older table without device ids: "everyone else" means every passkey.
    if (keep) return run(cfg, [['DELETE FROM sys_passkeys']], fetchImpl)
  })
}
const T_KEYS_PLAIN = 'CREATE TABLE IF NOT EXISTS sys_passkeys (id TEXT PRIMARY KEY, spki TEXT NOT NULL, alg INTEGER NOT NULL, counter INTEGER NOT NULL DEFAULT 0, label TEXT, created INTEGER NOT NULL, sid TEXT)'

export async function removePasskey(cfg, id, fetchImpl = fetch) {
  await run(cfg, [['DELETE FROM sys_passkeys WHERE id = ?', [String(id)]]], fetchImpl)
}
