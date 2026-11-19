// Real push notifications for the website and the installed phone app (N11):
// alerts arrive with no tab open. Standard Web Push with VAPID keys
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Vercel; make them once with
// `node scripts/vapid-keys.mjs`). The push itself carries no data: the phone's
// offline helper (public/sw.js) wakes up and asks this server for the newest
// unread notifications, proving who it is with its own push address.
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto'
import { run } from './_lib.mjs'

const T_PUSH = 'CREATE TABLE IF NOT EXISTS sys_push (endpoint TEXT PRIMARY KEY, created INTEGER NOT NULL, last_at TEXT)'
const b64u = (buf) => Buffer.from(buf).toString('base64url')

export const vapidPublic = (env = process.env) => String(env.VAPID_PUBLIC_KEY || '').trim()

/** A push address the browser gave us: https, a known push service shape, not too long. */
export function validEndpoint(e) {
  if (typeof e !== 'string' || e.length > 1000) return false
  try {
    const u = new URL(e)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

/** BG7: the device (session id) a push address belongs to, so signing it out stops its pushes. */
const ADD_SID = 'ALTER TABLE sys_push ADD COLUMN sid TEXT'
export async function subscribe(cfg, endpoint, fetchImpl = fetch, sid = null) {
  if (!validEndpoint(endpoint)) throw new Error('Not a push address')
  await run(cfg, [[T_PUSH]], fetchImpl)
  await run(cfg, [[ADD_SID]], fetchImpl).catch(() => {}) // already there
  await run(cfg, [['INSERT INTO sys_push (endpoint, created, sid) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET sid = excluded.sid', [endpoint, Date.now(), sid]], ['DELETE FROM sys_push WHERE endpoint NOT IN (SELECT endpoint FROM sys_push ORDER BY created DESC LIMIT 10)']], fetchImpl)
}

/** Drops push addresses when devices are signed out: one device's, or (keep) every one but that device's. */
export async function dropPush(cfg, sid, keep = false, fetchImpl = fetch) {
  await run(cfg, [[T_PUSH]], fetchImpl)
  await run(cfg, [[ADD_SID]], fetchImpl).catch(() => {}) // already there
  await run(cfg, [[keep ? 'DELETE FROM sys_push WHERE sid IS NOT ?' : 'DELETE FROM sys_push WHERE sid = ?', [sid == null ? null : String(sid)]]], fetchImpl)
}
export async function unsubscribe(cfg, endpoint, fetchImpl = fetch) {
  await run(cfg, [[T_PUSH], ['DELETE FROM sys_push WHERE endpoint = ?', [String(endpoint)]]], fetchImpl)
}

/**
 * Which bell entries may wake a phone (the daily push budget, core/notifyBudget.ts):
 * only the ones that passed budgetCheck, whose id is `budget:<slot>:<day>`
 * (slotNotifId: at most 4 a day). Everything else stays bell-only. When the
 * owner turned the budget off (simple_mode.budget === false), every unread one
 * may, as before the budget.
 */
export const PUSHABLE = "(id LIKE 'budget:%' OR (SELECT CASE WHEN json_valid(value) THEN json_extract(value, '$.budget') END FROM settings WHERE key = 'simple_mode') IS 0)"

/** The offline helper asks "what's new?" with its push address: the newest unread pushable ones (≤ 30 min old). */
export async function peek(cfg, endpoint, now = Date.now(), fetchImpl = fetch) {
  const [, known] = await run(cfg, [[T_PUSH], ['SELECT 1 FROM sys_push WHERE endpoint = ?', [String(endpoint)]]], fetchImpl)
  if (!known.length) return []
  const since = new Date(now - 30 * 60_000).toISOString()
  const [rows] = await run(cfg, [[`SELECT id, title, body, action FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL AND at >= ? AND at <= ? AND ${PUSHABLE} ORDER BY at DESC LIMIT 3`, [since, new Date(now).toISOString()]]], fetchImpl).catch(() => [[]])
  return rows.map(([id, title, body]) => ({ id: String(id), title: String(title), body: body == null ? '' : String(body) }))
}

/** A VAPID "Authorization" header for one push service (ES256 JWT, 12 hours). */
export function vapidAuth(endpoint, env = process.env, now = Date.now()) {
  const pub = Buffer.from(vapidPublic(env), 'base64url')
  const d = String(env.VAPID_PRIVATE_KEY || '').trim()
  if (pub.length !== 65 || !d) return null
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' })
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.APP_URL || 'https://mega-system-ten.vercel.app' }))
  const sig = cryptoSign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapidPublic(env)}`
}

/**
 * After each tick: if there are unread pushable notifications (PUSHABLE) newer
 * than the last push, wake every subscribed phone (an empty push). Gone subscriptions
 * (404/410) are removed.
 */
export async function pushNew(cfg, env = process.env, now = Date.now(), fetchImpl = fetch) {
  if (!vapidPublic(env) || !env.VAPID_PRIVATE_KEY) return 0
  const [, subs, newest] = await run(cfg, [[T_PUSH], ['SELECT endpoint, last_at FROM sys_push'], [`SELECT MAX(at) FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL AND at <= ? AND ${PUSHABLE}`, [new Date(now).toISOString()]]], fetchImpl)
  const latest = newest[0]?.[0]
  if (!latest || !subs.length) return 0
  let sent = 0
  for (const [endpoint, last] of subs) {
    if (last && String(last) >= String(latest)) continue
    const auth = vapidAuth(String(endpoint), env, now)
    if (!auth) return 0
    const r = await fetchImpl(String(endpoint), { method: 'POST', headers: { TTL: '1800', Urgency: 'normal', Authorization: auth, 'Content-Length': '0' } }).catch(() => null)
    if (r && (r.status === 404 || r.status === 410)) await unsubscribe(cfg, endpoint, fetchImpl)
    else if (r && r.status < 300) {
      sent++
      await run(cfg, [['UPDATE sys_push SET last_at = ? WHERE endpoint = ?', [String(latest), String(endpoint)]]], fetchImpl)
    }
  }
  return sent
}

/** A short id for logs (never the address itself). */
export const endpointId = (e) => createHash('sha256').update(String(e)).digest('base64url').slice(0, 10)
