// The always-on Telegram bot, on your own server (Vercel). Telegram sends each
// message here (a webhook); the bot reads Money's copy on the server, adds the
// record you typed ("coffee 35", "taxi 45 yesterday", "+500 salary"), writes it
// back with the same merge the apps use, and answers. The web and desktop apps
// get the record on their next sync (within a minute while they are open).
//
// Safe by design:
//  - Telegram must send the secret header set when the webhook was made
//    (derived from the server's session secret, never stored anywhere else).
//  - Only your chat is heard (MONEY_CHAT_ID, else TELEGRAM_CHAT_ID).
//  - Each record's id is tg-<update id>: a message Telegram sends twice is one record.
//  - Undo (the button under each reply, or /undo) removes it with a deletion
//    marker, like deleting it in the app; nothing else is touched.
// The bot token is MONEY_BOT_TOKEN, else FINANCE_BOT_TOKEN, in the server's settings.

import { createHash } from 'node:crypto'
import { normalizeState, SCHEMA_VERSION } from '../js/model.js'
import { parseQuick } from '../js/quickadd.js'
import { loggedText, todayText, balanceText, monthText, lastText } from '../js/telegram.js'
import { pushCopy, readValue } from './_money.mjs'

export const MONEY_TZ = 'Europe/Chisinau'

export function botConfig(env = process.env) {
  return {
    token: String(env.MONEY_BOT_TOKEN || env.FINANCE_BOT_TOKEN || '').trim(),
    chat: String(env.MONEY_CHAT_ID || env.TELEGRAM_CHAT_ID || '').trim(),
    api: String(env.FH_TG_API || 'https://api.telegram.org').replace(/\/+$/, ''),
  }
}

/** The secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token (A-Z a-z 0-9 _ -). */
export const webhookSecret = (cfg) => createHash('sha256').update(`money-bot-webhook:${cfg.secret}`).digest('hex').slice(0, 48)

/** The calendar day in Moldova for a time (ms). */
export function moneyDay(ms, tz = MONEY_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

export async function tg(bot, method, params = {}, fetchImpl = fetch) {
  const r = await fetchImpl(`${bot.api}/bot${bot.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const j = await r.json().catch(() => null)
  if (!j?.ok) throw new Error(j?.description || `Telegram answered ${r.status}`)
  return j.result
}

const state = (value) => normalizeState({ ...(value?.data || {}), version: SCHEMA_VERSION })

export const HELP = [
  '💸 <b>Your Money bot</b> (always on)',
  'Type what you spent: <code>coffee 35</code>, <code>taxi 45 maib</code>, <code>120+45 groceries</code>',
  'Income starts with +: <code>+500 salary</code>',
  'Another day: <code>yesterday 120 lunch</code>, <code>300 taxi 12 nov</code>, <code>mon 80 gym</code>',
  '',
  '/today · /month · /balance · /last · /undo',
].join('\n')

const undoButton = (id) => ({ inline_keyboard: [[{ text: '↩️ Undo', callback_data: `undo:${id}` }]] })

/** Removes one record by id (a deletion marker, like deleting it in the app). Returns the record or null. */
export async function removeRecord(cfg, id, now = Date.now(), fetchImpl = fetch) {
  const cur = await readValue(cfg, fetchImpl)
  const s = state(cur.value)
  const t = s.tx.find((x) => x.id === id)
  if (!t) return null
  s.tx = s.tx.filter((x) => x.id !== id)
  s.deleted = { ...(s.deleted || {}), [id]: now }
  await pushCopy(cfg, s, { edited: true, editedAt: now }, now, fetchImpl)
  return t
}

/**
 * One Telegram update → what to do. Returns a list of Telegram calls made
 * (for tests). `now` is the server time; the record's day is the day the
 * message was sent, in Moldova.
 */
export async function handleUpdate(cfg, bot, update, { now = Date.now(), fetchImpl = fetch, tgFetch = fetchImpl } = {}) {
  const calls = []
  const call = async (method, params) => { calls.push({ method, params }); return tg(bot, method, params, tgFetch).catch((e) => ({ error: e.message })) }

  // The Undo button under a reply.
  const cq = update.callback_query
  if (cq) {
    if (String(cq.message?.chat?.id ?? cq.from?.id) !== bot.chat) return calls
    const id = /^undo:(tg-\d+)$/.exec(cq.data || '')?.[1]
    if (!id) { await call('answerCallbackQuery', { callback_query_id: cq.id }); return calls }
    const t = await removeRecord(cfg, id, now, fetchImpl)
    await call('answerCallbackQuery', { callback_query_id: cq.id, text: t ? 'Removed' : 'Already removed' })
    if (t && cq.message) await call('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, parse_mode: 'HTML', text: `↩️ <s>${esc(t.note || '')} ${(t.amount / 100).toString().replace('.', ',')} ${esc(t.currency)}</s> removed` })
    return calls
  }

  const msg = update.message || update.edited_message
  if (!msg || update.edited_message) return calls // an edited message is not logged twice
  const chatId = String(msg.chat?.id ?? '')
  if (chatId !== bot.chat) return calls // only your own chat is heard
  const text = String(msg.text || '').trim()
  const reply = (t, extra = {}) => call('sendMessage', { chat_id: msg.chat.id, text: t, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
  if (!text) return calls
  const sentAt = (Number(msg.date) || Math.floor(now / 1000)) * 1000
  const today = moneyDay(sentAt)

  const cmd = /^\/(\w+)/.exec(text)?.[1]?.toLowerCase()
  if (cmd) {
    if (cmd === 'start' || cmd === 'help') { await reply(HELP); return calls }
    const cur = await readValue(cfg, fetchImpl)
    const s = state(cur.value)
    if (cmd === 'today') await reply(todayText(s, today))
    else if (cmd === 'month') await reply(monthText(s, today))
    else if (cmd === 'balance') await reply(balanceText(s))
    else if (cmd === 'last') await reply(lastText(s, 10))
    else if (cmd === 'undo') {
      const mine = s.tx.filter((t) => String(t.id).startsWith('tg-')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
      if (!mine || now - (mine.createdAt || 0) > 24 * 3600_000) await reply('Nothing from the bot in the last 24 hours to undo. Delete older records in the app.')
      else {
        await removeRecord(cfg, mine.id, now, fetchImpl)
        await reply(`↩️ Removed: <s>${esc(mine.note || '')} ${(mine.amount / 100).toString().replace('.', ',')} ${esc(mine.currency)}</s>`)
      }
    } else await reply(HELP)
    return calls
  }

  // A record. The same message twice (Telegram retries) is one record.
  const id = `tg-${update.update_id}`
  const cur = await readValue(cfg, fetchImpl)
  const s = state(cur.value)
  if (s.tx.some((t) => t.id === id) || s.deleted?.[id]) return calls
  const r = parseQuick(s, text, { today })
  if (!r.ok) { await reply(`🤔 ${esc(r.missing || 'Type an amount and what it was for, like "coffee 35".')}\n\n/help`); return calls }
  const t = { id, createdAt: now, updatedAt: now, ...r.tx, source: 'telegram' }
  s.tx.push(t)
  await pushCopy(cfg, s, { edited: true, editedAt: now }, now, fetchImpl)
  await reply(loggedText(s, t, today), { reply_markup: undoButton(id) })
  return calls
}

const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

/** Turn the always-on bot on: Telegram sends messages to `url` with the secret header. */
export async function setupBot(cfg, bot, url, fetchImpl = fetch) {
  const me = await tg(bot, 'getMe', {}, fetchImpl)
  await tg(bot, 'setWebhook', { url, secret_token: webhookSecret(cfg), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }, fetchImpl)
  await tg(bot, 'setMyCommands', { commands: [
    { command: 'today', description: 'Today and Safe to spend' },
    { command: 'month', description: 'This month so far' },
    { command: 'balance', description: 'All my money' },
    { command: 'last', description: 'Last 10 records' },
    { command: 'undo', description: 'Remove the last record from the bot' },
    { command: 'help', description: 'How to log' },
  ] }, fetchImpl).catch(() => {})
  return { bot: me.username }
}

export async function botStatus(cfg, bot, url, fetchImpl = fetch) {
  if (!bot.token) return { configured: false, why: 'No bot token on the server: add MONEY_BOT_TOKEN (or FINANCE_BOT_TOKEN) in Vercel → Settings → Environment Variables.' }
  if (!bot.chat) return { configured: false, why: 'No chat on the server: add MONEY_CHAT_ID (or TELEGRAM_CHAT_ID) in Vercel → Settings → Environment Variables.' }
  const [me, info] = await Promise.all([tg(bot, 'getMe', {}, fetchImpl), tg(bot, 'getWebhookInfo', {}, fetchImpl)])
  return {
    configured: true,
    bot: me.username,
    on: info.url === url,
    elsewhere: info.url && info.url !== url ? 'another address' : '',
    pending: info.pending_update_count || 0,
    lastError: info.last_error_message || '',
    lastErrorAt: info.last_error_date ? info.last_error_date * 1000 : 0,
  }
}

export async function stopBot(bot, fetchImpl = fetch) {
  await tg(bot, 'deleteWebhook', {}, fetchImpl)
  return { on: false }
}
