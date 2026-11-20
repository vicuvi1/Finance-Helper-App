// POST /api/telegram
//  - From Telegram (header X-Telegram-Bot-Api-Secret-Token): one update for the always-on bot
//    (api/_tgbot.mjs). Always answers 200 once handled, so Telegram doesn't send it again.
//  - From the app (Bearer session): {op:'status'} | {op:'on'} | {op:'off'}.
import { timingSafeEqual } from 'node:crypto'
import { bearer, config, readBody, requireSession, send } from './_lib.mjs'
import { botConfig, botStatus, handleUpdate, setupBot, stopBot, webhookSecret } from './_tgbot.mjs'

const same = (a, b) => {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && timingSafeEqual(x, y)
}
const hookUrl = (req) => `https://${String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()}/api/telegram`

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  const bot = botConfig()
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }

  const fromTelegram = req.headers['x-telegram-bot-api-secret-token']
  if (fromTelegram != null) {
    if (!same(fromTelegram, webhookSecret(cfg))) return send(res, 401, { error: 'Not Telegram' })
    if (!bot.token || !bot.chat) return send(res, 200, { ok: true, skipped: 'not configured' })
    try {
      await handleUpdate(cfg, bot, body || {})
      return send(res, 200, { ok: true })
    } catch (e) {
      // The database was busy: ask Telegram to send it again a bit later (the record id keeps it single).
      return send(res, 503, { error: e.message || 'Try again' })
    }
  }

  if (!(await requireSession(res, cfg, bearer(req)))) return
  try {
    const url = hookUrl(req)
    if (body?.op === 'on') {
      const st = await botStatus(cfg, bot, url)
      if (!st.configured) return send(res, 400, { error: st.why })
      await setupBot(cfg, bot, url)
      return send(res, 200, await botStatus(cfg, bot, url))
    }
    if (body?.op === 'off') {
      if (!bot.token) return send(res, 400, { error: 'No bot token on the server' })
      await stopBot(bot)
      return send(res, 200, await botStatus(cfg, bot, url))
    }
    return send(res, 200, await botStatus(cfg, bot, url))
  } catch (e) {
    return send(res, 502, { error: e.message || 'Telegram did not answer' })
  }
}
