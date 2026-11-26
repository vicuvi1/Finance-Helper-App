// Payments recorded by themselves from your phone (js/phonepay.js reads them).
//   POST /api/capture?k=<secret>  body: JSON {text} | {amount, merchant, card}, or the plain text
//        of a bank notification/SMS → {ok, saved, text}   (text: one line to show on the phone)
//   POST /api/capture?k=<secret>&q=alerts → {alerts: [{id, title, body}]} (Android phone notifications)
//   POST /api/capture?k=<secret> {quick: '120 lunch', at} → records it like Quick add (the Android tile)
//   POST /api/capture?k=<secret>&q=preview {text, at} → what it would save, your categories and cards (asks first)
//   POST /api/capture?k=<secret> {text, at, confirm: true, category, account, note, amount_set} → saves what you confirmed
//   POST /api/capture?k=<secret>&q=safe → {line: 'Safe to spend today: 412 MDL'} (the Android widget)
//   POST /api/capture {op:'link'|'reset'}  (Bearer session) → {url}   reset: the old link stops working
// The record goes into Money's copy on the server (the apps get it on their next sync) and, when
// the always-on bot is set up, Telegram says what was saved with an Undo button.
// The secret lives in sys_capture (a sys_ table: /api/db can't read it).
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { bearer, config, requireSession, run, send } from './_lib.mjs'
import { pushCopy, readValue } from './_money.mjs'
import { normalizeState, SCHEMA_VERSION } from '../js/model.js'
import { paymentRecord, paymentPreview } from '../js/phonepay.js'
import { formatMoney } from '../js/money.js'
import { safeLine } from '../js/safespend.js'
import { loggedText } from '../js/telegram.js'
import { trayLine } from '../js/trayline.js'
import { phoneAlerts } from '../js/phonealerts.js'
import { parseQuick } from '../js/quickadd.js'
import { createHash } from 'node:crypto'
import { botConfig, moneyDay, recordButtons, tg } from './_tgbot.mjs'

const T = 'CREATE TABLE IF NOT EXISTS sys_capture (id INTEGER PRIMARY KEY CHECK (id = 1), secret TEXT NOT NULL)'

async function secret(cfg, { reset = false } = {}) {
  const [, rows] = await run(cfg, [[T], ['SELECT secret FROM sys_capture WHERE id = 1']])
  if (rows[0] && !reset) return String(rows[0][0])
  const s = randomBytes(24).toString('base64url')
  await run(cfg, [['INSERT INTO sys_capture (id, secret) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET secret = excluded.secret', [s]]])
  return s
}
const same = (k, want) => {
  const a = Buffer.from(String(k || ''))
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** JSON, a form, or plain text (MacroDroid and Shortcuts can send any of them). */
async function body(req) {
  let raw = ''
  if (typeof req.body === 'string') raw = req.body
  else if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  else {
    const chunks = []
    for await (const c of req) chunks.push(c)
    raw = Buffer.concat(chunks).toString('utf8')
  }
  raw = raw.slice(0, 4000)
  const t = raw.trim()
  if (t.startsWith('{')) { try { return JSON.parse(t) } catch { /* plain text after all */ } }
  if (/^[\w.]+=/.test(t) && !/\s/.test(t.split('&')[0])) return Object.fromEntries(new URLSearchParams(t))
  return { text: t }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  const url = new URL(req.url, 'http://x')
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()

  if (!url.searchParams.has('k')) {
    if (!(await requireSession(res, cfg, bearer(req)))) return
    const b = await body(req).catch(() => ({}))
    const s = await secret(cfg, { reset: b?.op === 'reset' })
    return send(res, 200, { url: `https://${host}/api/capture?k=${s}` })
  }

  let want
  try { want = await secret(cfg) } catch { return send(res, 503, { error: 'Try again' }) }
  if (!same(url.searchParams.get('k'), want)) return send(res, 404, { error: 'Not found' })
  let input
  try { input = await body(req) } catch { return send(res, 400, { error: 'Bad request' }) }
  const now = Date.now()
  const today = moneyDay(now)
  // The Android app: phone notifications to show (it remembers which ones it showed).
  if (url.searchParams.get('q') === 'alerts') {
    try {
      const cur = await readValue(cfg)
      const st = normalizeState({ ...(cur.value?.data || {}), version: SCHEMA_VERSION })
      return send(res, 200, { ok: true, alerts: phoneAlerts(st, today) })
    } catch (e) {
      return send(res, 503, { error: e.message || 'Try again' })
    }
  }
  // The Android quick-add tile: "120 lunch" typed on the phone, read like Quick add (not "to check": you typed it).
  if (typeof input?.quick === 'string' && input.quick.trim()) {
    try {
      const text = input.quick.trim().slice(0, 200)
      const id = `qa-${createHash('sha256').update(`${text}|${input.at || Math.floor(now / 120000)}`).digest('hex').slice(0, 16)}`
      const cur = await readValue(cfg)
      const st = normalizeState({ ...(cur.value?.data || {}), version: SCHEMA_VERSION })
      if (st.tx.some((t) => t.id === id) || st.deleted?.[id]) return send(res, 200, { ok: true, saved: false, text: 'Already saved.' })
      const day = input.at ? moneyDay(Number(input.at)) : today
      const r = parseQuick(st, text, { today: day })
      if (!r.ok) return send(res, 200, { ok: true, saved: false, text: r.missing || 'Type an amount and what it was for, like "120 lunch".' })
      const t = { id, createdAt: now, updatedAt: now, ...r.tx, source: 'phone-quick' }
      st.tx.push(t)
      await pushCopy(cfg, st, { edited: true, editedAt: now }, now)
      const fmt = (c) => formatMoney(c, st.settings.currency || 'MDL', { reveal: true })
      let safe = ''
      try { safe = safeLine(st, today, fmt).replace(/<[^>]+>/g, '') } catch { /* not critical */ }
      const acc = (st.settings.accounts || []).find((a) => a.id === t.account)?.name || ''
      return send(res, 200, { ok: true, saved: true, id, text: `✅ ${t.type === 'income' ? '+' : ''}${formatMoney(t.amount, t.currency, { reveal: true })} · ${t.note || ''}${acc ? ` · ${acc}` : ''}${safe ? `\n${safe}` : ''}` })
    } catch (e) {
      return send(res, 503, { error: e.message || 'Try again' })
    }
  }
  // The Android app asks you first: what this payment would be saved as (nothing saved).
  if (url.searchParams.get('q') === 'preview') {
    try {
      const cur = await readValue(cfg)
      const st = normalizeState({ ...(cur.value?.data || {}), version: SCHEMA_VERSION })
      const p = paymentPreview(st, input || {}, { now, today, dayOf: moneyDay })
      if (!p.ok) return send(res, 200, { ok: true, payment: false, text: p.why || 'Not a payment' })
      return send(res, 200, { ok: true, payment: true, amount: p.amount, currency: p.currency, note: p.note, kind: p.kind, category: p.category, categoryName: p.categoryName, account: p.account, accountName: p.accountName, categories: p.categories, accounts: p.accounts })
    } catch (e) {
      return send(res, 503, { error: e.message || 'Try again' })
    }
  }
  // The Android widget: today's Safe to spend line, nothing recorded.
  if (url.searchParams.get('q') === 'safe') {
    try {
      const cur = await readValue(cfg)
      const st = normalizeState({ ...(cur.value?.data || {}), version: SCHEMA_VERSION })
      return send(res, 200, { ok: true, line: trayLine(st, today).line, today })
    } catch (e) {
      return send(res, 503, { error: e.message || 'Try again' })
    }
  }
  try {
    const cur = await readValue(cfg)
    const state = normalizeState({ ...(cur.value?.data || {}), version: SCHEMA_VERSION })
    const r = paymentRecord(state, input || {}, { now, today, dayOf: moneyDay })
    if (!r.ok) return send(res, 200, { ok: true, saved: false, text: r.why })
    state.tx.push(r.tx)
    await pushCopy(cfg, state, { edited: true, editedAt: now }, now)
    const fmt = (c) => formatMoney(c, state.settings.currency || 'MDL', { reveal: true })
    const acc = (state.settings.accounts || []).find((a) => a.id === r.tx.account)?.name || ''
    const line = `✅ ${r.tx.type === 'income' ? '+' : ''}${formatMoney(r.tx.amount, r.tx.currency, { reveal: true })} · ${r.tx.note}${acc ? ` · ${acc}` : ''}`
    let safe = ''
    try { safe = safeLine(state, today, fmt).replace(/<[^>]+>/g, '') } catch { /* not critical */ }
    const bot = botConfig()
    if (bot.token && bot.chat) {
      await tg(bot, 'sendMessage', { chat_id: bot.chat, parse_mode: 'HTML', disable_web_page_preview: true, text: `📱 From your phone\n${loggedText(state, r.tx, today)}`, reply_markup: recordButtons(r.tx.id) }).catch(() => null)
    }
    return send(res, 200, { ok: true, saved: true, id: r.tx.id, text: safe ? `${line}\n${safe}` : line })
  } catch (e) {
    return send(res, 503, { error: e.message || 'Try again' })
  }
}
