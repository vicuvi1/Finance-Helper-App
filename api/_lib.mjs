// The web app's small server (Vercel functions). It keeps the Turso and
// Telegram keys out of the page: the app logs in with its PIN, gets a
// session, and sends its database requests here. Files starting with "_"
// are not functions on Vercel.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { removeDevicePasskeys, revokedSids } from './_devices.mjs'
import { dropPush } from './_push.mjs'

// There is NO built-in PIN. While none was ever set (sys_auth is empty), nobody
// can sign in; the first PIN is set once with a secret the server already has
// (setupPin below: CRON_SECRET, or PIN_SETUP_SECRET when set).
export const NO_PIN_YET = 'No PIN is set yet'
// LT3: 14 days, renewed while you use the app (session.ts renewSession), so an
// unused or stolen session runs out sooner. A failed check is never a sign-out.
export const SESSION_DAYS = 14

export function config(env = process.env) {
  const url = (env.TURSO_URL || env.TURSO_DATABASE_URL || '').trim().replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '')
  const token = (env.TURSO_TOKEN || env.TURSO_AUTH_TOKEN || '').trim()
  const secret = env.SESSION_SECRET || (token ? createHash('sha256').update('life-session:' + token).digest('hex') : '')
  return { url, token, secret, ok: Boolean(url && token) }
}

/** Sends a hrana pipeline body to Turso; returns { status, json }. */
export async function turso(cfg, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.url}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { error: text.slice(0, 300) }
  }
  return { status: res.status, json }
}

const text = (v) => ({ type: 'text', value: String(v) })
const cell = (v) => (!v || v.type === 'null' ? null : v.value ?? null)

export async function getSetting(cfg, key, fetchImpl) {
  const { status, json } = await turso(cfg, { requests: [{ type: 'execute', stmt: { sql: 'SELECT value FROM settings WHERE key = ?', args: [text(key)] } }, { type: 'close' }] }, fetchImpl)
  const r = json?.results?.[0]
  if (status !== 200 || !r || r.type === 'error') throw new Error('Database not reachable')
  const row = r.response?.result?.rows?.[0]
  return row ? cell(row[0]) : null
}

export async function setSetting(cfg, key, value, fetchImpl) {
  await turso(cfg, {
    requests: [
      { type: 'execute', stmt: { sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [text(key), text(value)] } },
      { type: 'close' }
    ]
  }, fetchImpl)
}

const scryptAsync = (pin, salt) =>
  new Promise((resolve, reject) => scrypt(pin, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))))

/** The same check as the app and the desktop: "saltHex:scryptHex", or an old plain PIN. */
export async function pinMatches(stored, pin) {
  pin = String(pin ?? '')
  if (!stored) return false
  const [saltHex, hashHex] = String(stored).split(':')
  if (saltHex && hashHex) {
    const key = await scryptAsync(pin, Buffer.from(saltHex, 'hex'))
    const want = Buffer.from(hashHex, 'hex')
    return key.length === want.length && timingSafeEqual(key, want)
  }
  return /^\d{4,12}$/.test(stored) && stored === pin
}

const b64 = (s) => Buffer.from(s).toString('base64url')
export const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url')

/**
 * A session carries the "epoch" it was made in: a short hash of the PIN hash
 * and the sign-out counter. Changing the PIN or "Sign out all devices"
 * changes the epoch, and every older session stops working.
 */
export function makeSession(cfg, now = Date.now(), ep = '', sid = randomBytes(9).toString('base64url')) {
  // sid: this device's id (A6), so one device can be signed out on its own.
  const data = b64(JSON.stringify({ exp: now + SESSION_DAYS * 86400_000, ep, sid }))
  return `${data}.${sign(cfg.secret, data)}`
}

/** Signed by us and not expired: its payload, else null (no database read). */
export function sessionSigned(cfg, token, now = Date.now()) {
  if (!cfg.secret || typeof token !== 'string') return null
  const [data, sig] = token.split('.')
  if (!data || !sig) return null
  const want = Buffer.from(sign(cfg.secret, data))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString())
    return p.exp > now ? p : null
  } catch {
    return null
  }
}

// The PIN hash and the sign-out counter live in a server-only table (A1/A2):
// /api/db refuses it (_sqlguard.mjs), so a page can neither read the hash nor
// set a PIN of its own. The first read copies them over from settings, where
// older versions kept them, and then deletes settings.pin_hash: any signed-in
// page can read settings, and a 4-digit PIN falls from its hash in minutes.
// Nothing PIN-derived is ever written to settings again; a device checks the
// PIN offline against its own local copy (webAuth.ts localPinStore).
const T_AUTH = 'CREATE TABLE IF NOT EXISTS sys_auth (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
/** A new data marker: every device downloads everything once (and so drops its old copy of a deleted row). */
const bumpVersion = (tag, now = Date.now()) => ["INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`${tag}-${now}-${randomBytes(4).toString('hex')}`]]

/** { pin: "salt:hash" | null (none set: nobody signs in until setupPin), counter } from sys_auth. */
export async function authState(cfg, fetchImpl = fetch) {
  const [, , , rows, cleaned] = await run(
    cfg,
    [
      [T_AUTH],
      ["INSERT OR IGNORE INTO sys_auth (key, value) VALUES ('pin_hash', COALESCE((SELECT value FROM settings WHERE key = 'pin_hash'), ''))"],
      ["INSERT OR IGNORE INTO sys_auth (key, value) VALUES ('session_epoch', COALESCE((SELECT value FROM settings WHERE key = 'session_epoch'), '0'))"],
      ['SELECT key, value FROM sys_auth'],
      // The old copy goes (idempotent: nothing to delete after the first time).
      ["DELETE FROM settings WHERE key = 'pin_hash' RETURNING key"]
    ],
    fetchImpl
  )
  if (cleaned.length) await run(cfg, [bumpVersion('pin-clean')], fetchImpl)
  const m = Object.fromEntries(rows.map((r) => [String(r[0]), r[1] == null ? '' : String(r[1])]))
  return { pin: m.pin_hash || null, counter: m.session_epoch || '0' }
}

let epochCache = { at: 0, value: '' }
/** The current epoch (cached 30 s per server instance). */
export async function liveEpoch(cfg, fetchImpl = fetch, now = Date.now()) {
  if (epochCache.value && now - epochCache.at < 30_000) return epochCache.value
  const { pin, counter } = await authState(cfg, fetchImpl)
  const value = createHash('sha256').update(`${pin ?? ''}|${counter}`).digest('base64url').slice(0, 16)
  epochCache = { at: now, value }
  return value
}
export const forgetEpoch = () => (epochCache = { at: 0, value: '' })

/**
 * A valid session: signed, not expired, and from the current epoch.
 * When the database can't be reached it throws (it doesn't say "no"): a
 * network hiccup must never sign you out (A4).
 */
export async function sessionOk(cfg, token, now = Date.now(), fetchImpl = fetch) {
  const p = sessionSigned(cfg, token, now)
  if (!p) return false
  if (p.ep !== (await liveEpoch(cfg, fetchImpl, now))) return false
  // A device signed out on its own (A6).
  if (p.sid && (await revokedSids(cfg, fetchImpl, now)).has(p.sid)) return false
  return true
}

/**
 * For a handler: true when the session is valid. Otherwise it answers itself:
 * 401 (enter the PIN again) or 503 (couldn't check: the app keeps the session).
 */
export async function requireSession(res, cfg, token) {
  try {
    if (await sessionOk(cfg, token)) return true
    send(res, 401, { error: 'Locked: enter your PIN again' })
  } catch {
    send(res, 503, { error: 'Database not reachable: try again in a moment' })
  }
  return false
}

/**
 * "Sign out all devices": a new epoch, and the other devices' passkeys are
 * removed (A3), so a lost phone can't come back with its fingerprint.
 * Returns a fresh session for the device that asked (same device id).
 */
export async function signOutAll(cfg, now = Date.now(), fetchImpl = fetch, sid = null) {
  await authState(cfg, fetchImpl)
  await run(cfg, [["UPDATE sys_auth SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'session_epoch'"]], fetchImpl)
  await removeDevicePasskeys(cfg, sid, fetchImpl, true)
  // BG7: the other devices' push addresses go too (a lost phone stops getting notification text).
  await dropPush(cfg, sid, true, fetchImpl).catch(() => {})
  forgetEpoch()
  return makeSession(cfg, now, await liveEpoch(cfg, fetchImpl, now), sid || undefined)
}

/** The device id of a session we signed, even an expired or older one (to keep a device's id across logins). */
export function sidOf(cfg, token) {
  if (!cfg.secret || typeof token !== 'string') return null
  const [data, sig] = token.split('.')
  if (!data || !sig) return null
  const want = Buffer.from(sign(cfg.secret, data))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const sid = JSON.parse(Buffer.from(data, 'base64url').toString()).sid
    return typeof sid === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(sid) ? sid : null
  } catch {
    return null
  }
}

/** Runs statements in one Turso pipeline; returns each statement's rows (arrays of cells). */
export async function run(cfg, stmts, fetchImpl = fetch) {
  const arg = (v) => (v == null ? { type: 'null' } : typeof v === 'number' ? { type: 'integer', value: String(Math.round(v)) } : text(v))
  const { status, json } = await turso(cfg, { requests: [...stmts.map(([sql, args = []]) => ({ type: 'execute', stmt: { sql, args: args.map(arg) } })), { type: 'close' }] }, fetchImpl)
  if (status !== 200) throw new Error('Database not reachable')
  return stmts.map((_, k) => {
    const r = json?.results?.[k]
    if (!r || r.type === 'error') throw new Error(r?.error?.message || 'Database not reachable')
    return (r.response?.result?.rows ?? []).map((row) => row.map(cell))
  })
}

// Wrong PINs are counted per device (its IP) and for everyone together, in a
// table the app never downloads. Each try is counted BEFORE the PIN is
// checked, in one atomic statement, and only tries within the allowed count
// ("quota") are checked: a burst of parallel guesses can't slip through.
// One device: 5 tries, then a wait that doubles (1 min … 1 day) and one more
// try each time. Everyone together: 20 tries, then at most 15 minutes, so a
// stranger can't lock you out for long.
const GUARD_TABLE = 'CREATE TABLE IF NOT EXISTS sys_login_guard (scope TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0, quota INTEGER NOT NULL DEFAULT 5)'
const LIMITS = { ip: { free: 5, max: 86400_000 }, all: { free: 20, max: 15 * 60_000 } }
const wait = (fails, lim) => (fails >= lim.free ? Math.min(60_000 * 2 ** (fails - lim.free), lim.max) : 0)

/**
 * Checks a PIN with the wrong-PIN limits: null when it's right, else the
 * answer to send ({ status: 401 | 429, body }).
 */
export const checkPin = (cfg, pin, now = Date.now(), fetchImpl = fetch, ip = 'unknown') =>
  guardedTry(cfg, async () => pinMatches((await authState(cfg, fetchImpl)).pin, pin), 'Wrong PIN', now, fetchImpl, ip)

/** One counted try of a secret (`test` says whether it was right), with the limits above. */
async function guardedTry(cfg, test, wrong, now, fetchImpl, ip) {
  const scopes = [`ip:${String(ip).slice(0, 64)}`, 'all']
  const lims = [LIMITS.ip, LIMITS.all]
  const [, rows] = await run(cfg, [[GUARD_TABLE], ['SELECT scope, until FROM sys_login_guard WHERE scope IN (?, ?)', scopes]], fetchImpl)
  const blocked = Math.max(0, ...rows.map((r) => Number(r[1]) || 0))
  const tooMany = (until) => ({ status: 429, body: { error: `Too many tries. Wait ${Math.ceil((until - now) / 1000)} s` } })
  if (now < blocked) return tooMany(blocked)
  // Count this try first (atomic), then check the PIN.
  const bump = 'INSERT INTO sys_login_guard (scope, fails, until, quota) VALUES (?, 1, 0, ?) ON CONFLICT(scope) DO UPDATE SET fails = fails + 1 RETURNING fails, quota'
  const got = await run(cfg, scopes.map((sc, k) => [bump, [sc, lims[k].free]]), fetchImpl)
  const fails = got.map((r) => Number(r[0]?.[0]) || 1)
  const quota = got.map((r, k) => Number(r[0]?.[1]) || lims[k].free)
  // More tries than allowed (parallel guesses): refused without checking.
  if (fails.some((f, k) => f > quota[k])) {
    const until = now + 60_000
    const over = scopes.filter((_, k) => fails[k] > quota[k])
    await run(cfg, over.map((sc) => ['UPDATE sys_login_guard SET until = MAX(until, ?) WHERE scope = ?', [until, sc]]), fetchImpl)
    return tooMany(until)
  }
  if (!(await test())) {
    const waits = fails.map((f, k) => wait(f, lims[k]))
    const locks = waits.map((w, k) => [w ? 'UPDATE sys_login_guard SET until = ?, quota = ? WHERE scope = ?' : 'SELECT ?, ?, ?', [now + w, fails[k] + 1, scopes[k]]])
    if (Math.max(...waits)) await run(cfg, locks, fetchImpl)
    return Math.max(...waits) ? tooMany(now + Math.max(...waits)) : { status: 401, body: { error: wrong } }
  }
  await run(cfg, scopes.map((sc, k) => ['UPDATE sys_login_guard SET fails = 0, until = 0, quota = ? WHERE scope = ?', [lims[k].free, sc]]), fetchImpl)
  return null
}

/** `sid`: this device's id from its previous session (kept unless it was signed out). */
export async function login(cfg, pin, now = Date.now(), fetchImpl = fetch, ip = 'unknown', sid = null) {
  // No PIN was ever set: nothing opens the app (there is no default). The page shows the one-time setup.
  if (!(await authState(cfg, fetchImpl)).pin) return { status: 409, body: { error: `${NO_PIN_YET}. Set the first one with the server's setup key.`, setup: true } }
  const refused = await checkPin(cfg, pin, now, fetchImpl, ip)
  if (refused) return refused
  forgetEpoch()
  if (sid && (await revokedSids(cfg, fetchImpl, now)).has(sid)) sid = null
  return { status: 200, body: { session: makeSession(cfg, now, await liveEpoch(cfg, fetchImpl, now), sid || undefined) } }
}

/** "saltHex:scryptHex", the format the app and the desktop read. */
export async function hashPinServer(pin, salt = randomBytes(16)) {
  return `${salt.toString('hex')}:${(await scryptAsync(String(pin), salt)).toString('hex')}`
}

const sameSecret = (a, b) => {
  const [x, y] = [a, b].map((v) => createHash('sha256').update(String(v ?? '')).digest())
  return timingSafeEqual(x, y)
}

/**
 * The FIRST PIN (only while none is set): it needs a secret the server
 * already has in its environment (PIN_SETUP_SECRET, else CRON_SECRET), typed
 * once on the setup screen. Never a built-in value. Wrong keys are counted
 * like wrong PINs. 4 to 8 digits. Once a PIN exists this answers 409 for
 * good: a PIN is changed with changePin (the current PIN and a session).
 */
export async function setupPin(cfg, key, pin, now = Date.now(), fetchImpl = fetch, ip = 'unknown', env = process.env) {
  const want = String(env.PIN_SETUP_SECRET || env.CRON_SECRET || '').trim()
  if (!want) return { status: 503, body: { error: 'First PIN setup needs CRON_SECRET in the server settings (Vercel → Environment Variables)' } }
  if ((await authState(cfg, fetchImpl)).pin) return { status: 409, body: { error: 'A PIN is already set: sign in with it' } }
  pin = String(pin ?? '')
  if (!/^\d{4,8}$/.test(pin)) return { status: 400, body: { error: 'PIN must be 4 to 8 digits' } }
  const refused = await guardedTry(cfg, async () => sameSecret(String(key ?? '').trim(), want), 'Wrong setup key', now, fetchImpl, ip)
  if (refused) return refused
  const hash = await hashPinServer(pin)
  // Only into the empty slot (two setups at once: one wins).
  const [set] = await run(cfg, [["UPDATE sys_auth SET value = ? WHERE key = 'pin_hash' AND value = '' RETURNING key", [hash]]], fetchImpl)
  if (!set.length) return { status: 409, body: { error: 'A PIN is already set: sign in with it' } }
  forgetEpoch()
  return { status: 200, body: { session: makeSession(cfg, now, await liveEpoch(cfg, fetchImpl, now)) } }
}

/**
 * A new PIN, checked here (A2): the current PIN must be right (same wrong-PIN
 * limits as the login). Every other session ends; this device gets a fresh
 * one. The hash stays in sys_auth only; each device keeps its own offline copy.
 */
export async function changePin(cfg, current, next, sid, now = Date.now(), fetchImpl = fetch, ip = 'unknown') {
  next = String(next ?? '')
  if (!/^\d{4,12}$/.test(next)) return { status: 400, body: { error: 'PIN must be 4 to 12 digits' } }
  const refused = await checkPin(cfg, current, now, fetchImpl, ip)
  if (refused) return refused.status === 401 ? { status: 403, body: { error: 'Current PIN is wrong' } } : refused
  const hash = await hashPinServer(next)
  await run(
    cfg,
    [
      ["UPDATE sys_auth SET value = ? WHERE key = 'pin_hash'", [hash]],
      // Only in sys_auth: never a copy in settings, which every signed-in page can read.
      ["DELETE FROM settings WHERE key = 'pin_hash'"]
    ],
    fetchImpl
  )
  forgetEpoch()
  return { status: 200, body: { session: makeSession(cfg, now, await liveEpoch(cfg, fetchImpl, now), sid || undefined) } }
}

/**
 * Forgot the PIN (standalone Money app): the server's setup key (PIN_SETUP_SECRET, else
 * CRON_SECRET: only someone who can open the Vercel project has it) sets a new PIN, whether
 * one was set or not. Wrong keys count like wrong PINs (same lockout). Every other device is
 * signed out (the session epoch moves), so an old PIN or a lost device opens nothing.
 */
export async function resetPin(cfg, key, pin, now = Date.now(), fetchImpl = fetch, ip = 'unknown', env = process.env) {
  const want = String(env.PIN_SETUP_SECRET || env.CRON_SECRET || '').trim()
  if (!want) return { status: 503, body: { error: 'A PIN reset needs CRON_SECRET in the server settings (Vercel → Environment Variables)' } }
  pin = String(pin ?? '')
  if (!/^\d{4,8}$/.test(pin)) return { status: 400, body: { error: 'PIN must be 4 to 8 digits' } }
  const refused = await guardedTry(cfg, async () => sameSecret(String(key ?? '').trim(), want), 'Wrong setup key', now, fetchImpl, ip)
  if (refused) return refused
  await authState(cfg, fetchImpl)
  const hash = await hashPinServer(pin)
  await run(cfg, [
    ["UPDATE sys_auth SET value = ? WHERE key = 'pin_hash'", [hash]],
    ["DELETE FROM settings WHERE key = 'pin_hash'"]
  ], fetchImpl)
  return { status: 200, body: { session: await signOutAll(cfg, now, fetchImpl, null) } }
}

/** The caller's IP (Vercel puts the real one first in x-forwarded-for). */
export const clientIp = (req) => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || 'unknown').trim()

/** The bot settings the app starts from (tokens live in the server's settings). */
export function botDefaults(env = process.env) {
  const chat = env.TELEGRAM_CHAT_ID || ''
  const main = env.TELEGRAM_BOT_TOKEN || ''
  return {
    // Bots run by their own program: the app never reads them.
    skipBotIds: leftBots(env).map((b) => b.id),
    megaBotToken: env.MEGA_BOT_TOKEN || '',
    botToken: main,
    chatId: chat,
    sportBotToken: env.SPORT_BOT_TOKEN || main,
    sportBotChatId: chat,
    financeBotToken: env.FINANCE_BOT_TOKEN || '',
    financeBotChatId: chat,
    manBotToken: env.MAN_BOT_TOKEN || '',
    wakyBotToken: env.WAKY_BOT_TOKEN || '',
    manBotChatId: chat
  }
}

export const bearer = (req) => String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}')
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString() || '{}')
}

export function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

const BOT_VARS = ['MEGA_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SPORT_BOT_TOKEN', 'FINANCE_BOT_TOKEN', 'MAN_BOT_TOKEN', 'WAKY_BOT_TOKEN']

/** Bots run by their own program (e.g. Sporty's Python bot): BOTS_NOT_ON_SERVER=TELEGRAM_BOT_TOKEN,… */
export function leftBots(env = process.env) {
  const names = String(env.BOTS_NOT_ON_SERVER || '').split(',').map((s) => s.trim()).filter(Boolean)
  return names.map((name) => ({ name, token: (env[name] || '').trim() })).filter((b) => b.token.includes(':')).map((b) => ({ ...b, id: b.token.split(':')[0] }))
}

/** The bots the server answers, one entry per bot (same token twice is one bot). */
export function serverBots(env = process.env) {
  const left = new Set(leftBots(env).map((b) => b.id))
  const out = []
  for (const name of BOT_VARS) {
    const token = (env[name] || '').trim()
    if (!token.includes(':')) continue
    const id = token.split(':')[0]
    if (!left.has(id) && !out.some((b) => b.id === id)) out.push({ name, id, token })
  }
  return out
}

/** The secret Telegram sends with each message to a bot, so nobody else can post as it. */
export const webhookSecret = (cfg, botId) => sign(cfg.secret, 'telegram:' + botId)

/** One Telegram Bot API call (8 s at most). */
export async function tg(token, method, body, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000)
  })
  return res.json()
}

/** Where a bot's messages should go: this server's /api/telegram. */
export const webhookUrl = (host, bot) => `https://${host}/api/telegram?bot=${bot.id}`

/**
 * Points a bot at this server (POST /api/bot-setup and the daily self-check,
 * CL3). With `info` (getWebhookInfo already read) and `force`, set it again
 * even when the link looks right (deliveries were failing).
 */
export async function ensureWebhook(cfg, bot, host, { info = null, force = false, fetchImpl = fetch } = {}) {
  const url = webhookUrl(host, bot)
  const now = info ?? (await tg(bot.token, 'getWebhookInfo', undefined, fetchImpl))
  const kinds = now?.result?.allowed_updates ?? []
  if (!force && now?.result?.url === url && kinds.includes('callback_query')) return { bot: bot.name, ok: true, already: true }
  const set = await tg(bot.token, 'setWebhook', { url, secret_token: webhookSecret(cfg, bot.id), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }, fetchImpl)
  return { bot: bot.name, ok: !!set?.ok, error: set?.ok ? undefined : set?.description }
}

/**
 * CL3: each server bot's link checked (right address, no delivery errors in
 * 24 h, under 50 messages waiting) and set again when wrong. `fix` is off
 * outside production (a preview must not take the bots from the live site).
 * `verdict` is webhookVerdict from src/core/selfCheck.ts (passed in, so this
 * file stays small for every function).
 */
export async function checkWebhooks(cfg, host, verdict, { fix = true, bots = serverBots(), fetchImpl = fetch, now = new Date() } = {}) {
  const out = []
  for (const b of bots) {
    try {
      const info = await tg(b.token, 'getWebhookInfo', undefined, fetchImpl)
      if (!info?.ok) {
        out.push({ name: b.name, ok: false, error: info?.description || 'Telegram refused the bot token' })
        continue
      }
      const h = info.result ?? {}
      const v = verdict(h, webhookUrl(host, b), now)
      const base = { name: b.name, pending: h.pending_update_count ?? null, lastErrorAt: h.last_error_date ? new Date(h.last_error_date * 1000).toISOString() : null, lastError: h.last_error_message ?? null }
      if (v.ok || !v.fix || !fix) {
        out.push({ ...base, ok: v.ok, error: v.ok ? null : `The link ${v.problem}` })
        continue
      }
      const r = await ensureWebhook(cfg, b, host, { info, force: true, fetchImpl })
      out.push({ ...base, ok: r.ok, fixed: r.ok, error: r.ok ? null : `The link ${v.problem}, and setting it again failed: ${r.error || 'no answer'}` })
    } catch (e) {
      out.push({ name: b.name, ok: false, error: e.message })
    }
  }
  return out
}

// ---- CL2: how many calls the server answers (Settings → System health) ----
// Counted in memory and written now and then (every 25 calls or 2 minutes), so
// counting never doubles the database work. A count can be lost when Vercel
// stops an instance, so the number is "about".
const counts = { n: {}, rows: 0, pending: 0, at: Date.now() }
export async function countCall(cfg, name, rows = 0, fetchImpl = fetch, now = Date.now()) {
  if (!cfg?.ok) return
  const key = String(name).replace(/[^a-z]/gi, '').slice(0, 20) || 'other'
  counts.n[key] = (counts.n[key] ?? 0) + 1
  counts.rows += Number(rows) || 0
  counts.pending++
  if (counts.pending < 25 && now - counts.at < 120_000) return
  const n = counts.n
  const total = counts.pending
  const read = counts.rows
  counts.n = {}
  counts.rows = 0
  counts.pending = 0
  counts.at = now
  const month = new Date(now).toISOString().slice(0, 7)
  const add = { ...n, total, rows: read }
  let expr = "COALESCE(sys_health.msg, '{}')"
  const args = [`note:calls:${month}`, new Date(now).toISOString(), JSON.stringify(add)]
  for (const [k, v] of Object.entries(add)) {
    expr = `json_set(${expr}, '$.${k}', COALESCE(json_extract(sys_health.msg, '$.${k}'), 0) + ?)`
    args.push(v)
  }
  await run(cfg, [
    ['CREATE TABLE IF NOT EXISTS sys_health (key TEXT PRIMARY KEY, at TEXT NOT NULL, msg TEXT)'],
    [`INSERT INTO sys_health (key, at, msg) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, msg = ${expr}`, args]
  ], fetchImpl).catch(() => {})
}
/** Rows in a Turso pipeline answer (for countCall). */
export function rowsOf(json) {
  let n = 0
  for (const r of json?.results ?? []) {
    const res = r?.response?.result
    n += res?.rows?.length ?? 0
    for (const st of res?.step_results ?? []) n += st?.rows?.length ?? 0
  }
  return n
}

/** "Authorization: Bearer <CRON_SECRET>", compared in constant time. */
export function cronSecretOk(req, env = process.env) {
  return bearerIs(req, env.CRON_SECRET)
}

/** "Authorization: Bearer <secret>" for any shared secret (CRON_SECRET, SPORT_SYNC_KEY), in constant time. */
export function bearerIs(req, secret) {
  const want = String(secret || '').trim()
  const got = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!want || !got) return false
  const a = createHash('sha256').update(want).digest()
  const b = createHash('sha256').update(got).digest()
  return timingSafeEqual(a, b)
}

/**
 * At most once per `gapMs` for a job, across every server instance (one
 * atomic statement in Turso): true when this caller won the slot.
 */
export async function gate(cfg, name, gapMs, now = Date.now(), fetchImpl = fetch) {
  const [, rows] = await run(
    cfg,
    [
      ['CREATE TABLE IF NOT EXISTS sys_gate (name TEXT PRIMARY KEY, at INTEGER NOT NULL)'],
      ['INSERT INTO sys_gate (name, at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET at = excluded.at WHERE sys_gate.at <= ? RETURNING at', [name, now, now - gapMs]]
    ],
    fetchImpl
  )
  return rows.length > 0
}
