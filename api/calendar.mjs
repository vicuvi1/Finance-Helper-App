// Your subscriptions and bills as a calendar Google Calendar (or any calendar app) can follow.
//   GET  /api/calendar?k=<secret>     → an .ics file: every repeating payment for the next 6 months
//   POST /api/calendar {op:'link'}    → {url}   (Bearer session; makes the secret once)
//   POST /api/calendar {op:'reset'}   → {url}   a new secret: the old link stops working
//   GET  /api/calendar?s=<secret>&t=records|months → CSV for Google Sheets =IMPORTDATA (js/sheetfeed.js)
//   POST /api/calendar {op:'sheet-link'|'sheet-reset'} → {records, months}   (its own secret)
// The secrets live in sys_calendar / sys_sheetfeed (sys_ tables: /api/db can't read them).
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { bearer, config, readBody, requireSession, run, send } from './_lib.mjs'
import { readValue } from './_money.mjs'
import { normalizeState, SCHEMA_VERSION } from '../js/model.js'
import { occurrences } from '../js/recurring.js'
import { addDays } from '../js/dates.js'
import { formatMoney } from '../js/money.js'
import { recordsCSV, monthsCSV } from '../js/sheetfeed.js'

const T = 'CREATE TABLE IF NOT EXISTS sys_calendar (id INTEGER PRIMARY KEY CHECK (id = 1), secret TEXT NOT NULL)'
const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Chisinau', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
const icsText = (s) => String(s ?? '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n')
const fold = (line) => line.length <= 74 ? line : line.match(/.{1,74}/gu).join('\r\n ')

const T_SHEET = 'CREATE TABLE IF NOT EXISTS sys_sheetfeed (id INTEGER PRIMARY KEY CHECK (id = 1), secret TEXT NOT NULL)'

async function secret(cfg, { reset = false, table = 'sys_calendar', create = T } = {}) {
  const [, rows] = await run(cfg, [[create], [`SELECT secret FROM ${table} WHERE id = 1`]])
  if (rows[0] && !reset) return String(rows[0][0])
  const s = randomBytes(24).toString('base64url')
  await run(cfg, [[`INSERT INTO ${table} (id, secret) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET secret = excluded.secret`, [s]]])
  return s
}
const SHEET = { table: 'sys_sheetfeed', create: T_SHEET }
const same = (k, want) => {
  const a = Buffer.from(String(k || ''))
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The .ics for a Money state: all-day events, a reminder the day before at 9:00. */
export function calendarICS(state, today, { months = 6, now = Date.now() } = {}) {
  const to = addDays(today, months * 31)
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finance Helper//Money//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Money: bills & subscriptions', 'X-WR-TIMEZONE:Europe/Chisinau']
  for (const r of state.recurring || []) {
    if (r.type !== 'expense' || r.paused) continue
    const acc = (state.settings.accounts || []).find((a) => a.id === r.account)
    for (const d of occurrences(r, today, to, 40)) {
      const ymd = d.replace(/-/g, '')
      const next = addDays(d, 1).replace(/-/g, '')
      lines.push('BEGIN:VEVENT', `UID:${r.id}-${d}@finance-helper`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${next}`,
        fold(`SUMMARY:${icsText(`${r.note || 'Payment'} ${formatMoney(r.amount, r.currency, { reveal: true })}${acc ? ` · ${acc.name}` : ''}`)}`),
        fold(`DESCRIPTION:${icsText(`From Finance Helper. ${r.subscription ? 'Subscription' : 'Repeating payment'}${acc ? `, paid from ${acc.name}` : ''}.`)}`),
        'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15H', fold(`DESCRIPTION:${icsText(`${r.note || 'Payment'} is due tomorrow`)}`), 'END:VALARM', 'END:VEVENT')
    }
  }
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

export default async function handler(req, res) {
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.searchParams.has('s')) {
    let want
    try { want = await secret(cfg, SHEET) } catch { return send(res, 503, { error: 'Try again' }) }
    if (!same(url.searchParams.get('s'), want)) return send(res, 404, { error: 'Not found' })
    const cur = await readValue(cfg)
    const state = normalizeState({ ...(cur.value?.data || {}), version: SCHEMA_VERSION })
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.end(url.searchParams.get('t') === 'months' ? monthsCSV(state, day(Date.now())) : recordsCSV(state))
  }
  if (req.method === 'GET') {
    const k = url.searchParams.get('k') || ''
    let want
    try { want = await secret(cfg) } catch { return send(res, 503, { error: 'Try again' }) }
    const a = Buffer.from(k)
    const b = Buffer.from(want)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return send(res, 404, { error: 'Not found' })
    const cur = await readValue(cfg)
    const state = normalizeState({ ...(cur.value?.data || {}), version: SCHEMA_VERSION })
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.end(calendarICS(state, day(Date.now())))
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' })
  if (!(await requireSession(res, cfg, bearer(req)))) return
  const body = await readBody(req).catch(() => ({}))
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  if (body?.op === 'sheet-link' || body?.op === 'sheet-reset') {
    const s = await secret(cfg, { ...SHEET, reset: body.op === 'sheet-reset' })
    return send(res, 200, { records: `https://${host}/api/calendar?s=${s}&t=records`, months: `https://${host}/api/calendar?s=${s}&t=months` })
  }
  const s = await secret(cfg, { reset: body?.op === 'reset' })
  return send(res, 200, { url: `https://${host}/api/calendar?k=${s}` })
}
