// Passkey unlock (fingerprint / face / Windows Hello) next to the PIN (M7).
// Everything is checked here on the server:
// - a one-time challenge (5 minutes, used once) from /api/login {passkey:'options'};
// - registering needs a valid session (you unlocked with the PIN first);
// - unlocking: the challenge, the page's origin, the site (rpId hash), the
//   user-present and user-verified flags, and the signature over
//   authenticatorData + SHA-256(clientDataJSON) with the stored public key.
// Keys live in server-only tables (sys_), never synced to devices.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import { liveEpoch, makeSession, run } from './_lib.mjs'
import { newSid } from './_devices.mjs'

const T_CHAL = 'CREATE TABLE IF NOT EXISTS sys_passkey_chal (challenge TEXT PRIMARY KEY, op TEXT NOT NULL, exp INTEGER NOT NULL)'
// sid: the device that made it (A3): signing that device out removes it too.
export const T_KEYS = 'CREATE TABLE IF NOT EXISTS sys_passkeys (id TEXT PRIMARY KEY, spki TEXT NOT NULL, alg INTEGER NOT NULL, counter INTEGER NOT NULL DEFAULT 0, label TEXT, created INTEGER NOT NULL, sid TEXT)'

/** The table, with the sid column added on older databases. */
export async function ensureKeys(cfg, fetchImpl = fetch) {
  await run(cfg, [[T_KEYS]], fetchImpl)
  await run(cfg, [['ALTER TABLE sys_passkeys ADD COLUMN sid TEXT']], fetchImpl).catch(() => null) // already there
}
const b64u = (buf) => Buffer.from(buf).toString('base64url')
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url')
const sha256 = (b) => createHash('sha256').update(b).digest()

/** The site and origin the browser must have used (from the request's host). */
export function expectedSite(req) {
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim().toLowerCase()
  const rpId = host.replace(/:\d+$/, '')
  const proto = rpId === 'localhost' || rpId === '127.0.0.1' ? 'http' : 'https'
  return { rpId, origin: `${proto}://${host}` }
}

/** A fresh one-time challenge for 'register' or 'login', plus the ids of your passkeys (for login). */
export async function passkeyOptions(cfg, op, now = Date.now(), fetchImpl = fetch) {
  if (op !== 'register' && op !== 'login') throw new Error('Unknown passkey step')
  const challenge = b64u(randomBytes(32))
  const [, , , ids] = await run(cfg, [[T_CHAL], [T_KEYS], ['DELETE FROM sys_passkey_chal WHERE exp < ?', [now]], ['SELECT id FROM sys_passkeys ORDER BY created'], ['INSERT INTO sys_passkey_chal (challenge, op, exp) VALUES (?, ?, ?)', [challenge, op, now + 5 * 60000]]], fetchImpl)
  return { challenge, credentials: ids.map((r) => String(r[0])) }
}

/** Checks clientDataJSON: type, our origin, and a challenge we issued (used up here). */
async function takeClientData(cfg, clientDataJSON, type, origin, op, now, fetchImpl) {
  let cd
  try {
    cd = JSON.parse(fromB64u(clientDataJSON).toString('utf8'))
  } catch {
    throw new Error('Passkey answer unreadable')
  }
  if (cd.type !== type) throw new Error('Wrong passkey step')
  if (cd.origin !== origin) throw new Error('Passkey from another site')
  const [rows] = await run(cfg, [['DELETE FROM sys_passkey_chal WHERE challenge = ? AND op = ? AND exp >= ? RETURNING challenge', [String(cd.challenge || ''), op, now]]], fetchImpl)
  if (!rows.length) throw new Error('Passkey request expired: try again')
}

/** Saves a new passkey (only with a valid session: the PIN came first); `sid`: that session's device. */
export async function passkeyRegister(cfg, body, site, now = Date.now(), fetchImpl = fetch, sid = null) {
  await ensureKeys(cfg, fetchImpl)
  await takeClientData(cfg, body.clientDataJSON, 'webauthn.create', site.origin, 'register', now, fetchImpl)
  const alg = Number(body.alg)
  if (alg !== -7 && alg !== -257) throw new Error('This passkey type is not supported')
  const spki = fromB64u(body.publicKey)
  createPublicKey({ key: spki, format: 'der', type: 'spki' }) // throws if it isn't a key
  const auth = fromB64u(body.authenticatorData)
  if (auth.length < 37 || !timingSafeEqual(auth.subarray(0, 32), sha256(site.rpId))) throw new Error('Passkey for another site')
  const id = String(body.credentialId || '')
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(id)) throw new Error('Passkey id missing')
  const [, , [[n]]] = await run(cfg, [[T_KEYS], ['INSERT OR REPLACE INTO sys_passkeys (id, spki, alg, counter, label, created, sid) VALUES (?, ?, ?, 0, ?, ?, ?)', [id, b64u(spki), alg, String(body.label || 'This device').slice(0, 40), now, sid]], ['SELECT COUNT(*) FROM sys_passkeys']], fetchImpl)
  if (Number(n) > 5) await run(cfg, [['DELETE FROM sys_passkeys WHERE id IN (SELECT id FROM sys_passkeys ORDER BY created LIMIT ?)', [Number(n) - 5]]], fetchImpl)
  return { ok: true }
}

/** Unlocks with a passkey: every check passes → a session, like the PIN. */
export async function passkeyLogin(cfg, body, site, now = Date.now(), fetchImpl = fetch) {
  const id = String(body.credentialId || '')
  await ensureKeys(cfg, fetchImpl)
  const [rows] = await run(cfg, [['SELECT spki, alg, counter, sid FROM sys_passkeys WHERE id = ?', [id]]], fetchImpl)
  if (!rows.length) throw new Error('Unknown passkey: unlock with your PIN')
  await takeClientData(cfg, body.clientDataJSON, 'webauthn.get', site.origin, 'login', now, fetchImpl)
  const [spki, alg, counter, keySid] = rows[0]
  const auth = fromB64u(body.authenticatorData)
  if (auth.length < 37 || !timingSafeEqual(auth.subarray(0, 32), sha256(site.rpId))) throw new Error('Passkey for another site')
  const flags = auth[32]
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error('Fingerprint or face was not checked')
  const signed = Buffer.concat([auth, sha256(fromB64u(body.clientDataJSON))])
  const key = createPublicKey({ key: fromB64u(spki), format: 'der', type: 'spki' })
  const ok = verify(Number(alg) === -257 ? 'RSA-SHA256' : 'sha256', signed, key, fromB64u(body.signature))
  if (!ok) throw new Error('Passkey signature is wrong')
  const count = auth.readUInt32BE(33)
  if (count !== 0 && count <= Number(counter)) throw new Error('Passkey was copied: unlock with your PIN')
  // The session keeps the device of the passkey, so signing that device out ends it (A3).
  const sid = keySid ? String(keySid) : newSid()
  await run(cfg, [['UPDATE sys_passkeys SET counter = ?, sid = ? WHERE id = ?', [count, sid, id]]], fetchImpl)
  return { session: makeSession(cfg, now, await liveEpoch(cfg, fetchImpl, now), sid) }
}
