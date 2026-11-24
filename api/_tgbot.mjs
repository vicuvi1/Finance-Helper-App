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
import { loggedText, todayText, balanceText, monthText, lastText, weeklyText } from '../js/telegram.js'
import { formatMoney } from '../js/money.js'
import { safeLine, shortDay } from '../js/safespend.js'
import { subscriptionTable } from '../js/subtable.js'
import { dueItems, upcomingItems } from '../js/recurring.js'
import { weeklyReview } from '../js/review.js'
import { recapText } from '../js/recap.js'
import { smartSteps } from '../js/smartwarn.js'
import { streaks, streakLine } from '../js/streaks.js'
import { rateAdvice, heldIn } from '../js/fxsmart.js'
import { accountBalances, budgetStatus } from '../js/model.js'
import { addMonths, monthKey } from '../js/dates.js'
import { pushCopy, readValue } from './_money.mjs'
import { run } from './_lib.mjs'
import { answer, isQuestion, splitRecords, readReminder } from '../js/botask.js'

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
  'Several at once: <code>lunch 120, taxi 45, coffee 30</code>',
  '',
  '<b>Ask in plain words</b>: <code>food this month</code>, <code>taxi in October</code>, <code>and last month?</code>, <code>can I afford 3000</code>, <code>what\'s left today</code>, <code>when is rent</code>, <code>where did my money go</code>',
  'Reminders: <code>remind me to pay internet on the 27th</code> · /reminders',
  '',
  '/today · /month · /balance · /last · /undo',
].join('\n')

// The last question per chat (30 minutes), so "and last month?" knows what you asked; reminders.
const T_CTX = 'CREATE TABLE IF NOT EXISTS sys_bot_ctx (chat TEXT PRIMARY KEY, json TEXT NOT NULL, at INTEGER NOT NULL)'
const T_REM = 'CREATE TABLE IF NOT EXISTS sys_bot_reminders (id TEXT PRIMARY KEY, due TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)'
async function readCtx(cfg, chat, now, fetchImpl) {
  const [, rows] = await run(cfg, [[T_CTX], ['SELECT json, at FROM sys_bot_ctx WHERE chat = ?', [chat]]], fetchImpl).catch(() => [null, []])
  if (!rows?.[0] || now - Number(rows[0][1]) > 30 * 60000) return null
  try { return JSON.parse(String(rows[0][0])) } catch { return null }
}
const saveCtx = (cfg, chat, ctx, now, fetchImpl) => run(cfg, [[T_CTX], ['INSERT INTO sys_bot_ctx (chat, json, at) VALUES (?, ?, ?) ON CONFLICT(chat) DO UPDATE SET json = excluded.json, at = excluded.at', [chat, JSON.stringify(ctx || {}), now]]], fetchImpl).catch(() => null)
export async function listReminders(cfg, fetchImpl = fetch) {
  const [, rows] = await run(cfg, [[T_REM], ['SELECT id, due, text FROM sys_bot_reminders WHERE done = 0 ORDER BY due, created LIMIT 30']], fetchImpl)
  return rows.map(([id, due, text]) => ({ id: String(id), due: String(due), text: String(text) }))
}
/** Reminders due by `today` (marked done as they are handed out). */
export async function takeDueReminders(cfg, today, fetchImpl = fetch) {
  const [, rows] = await run(cfg, [[T_REM], ['SELECT id, due, text FROM sys_bot_reminders WHERE done = 0 AND due <= ? ORDER BY due', [today]]], fetchImpl)
  if (rows.length) await run(cfg, [['UPDATE sys_bot_reminders SET done = 1 WHERE done = 0 AND due <= ?', [today]]], fetchImpl)
  return rows.map(([id, due, text]) => ({ id: String(id), due: String(due), text: String(text) }))
}

// Under each saved record: Undo, and change its category or account (the next record from the
// same shop then gets the category you picked: the app learns from your records).
export const recordButtons = (id) => ({ inline_keyboard: [[{ text: '↩️ Undo', callback_data: `undo:${id}` }, { text: '🏷 Category', callback_data: `rc:${id}` }, { text: '💳 Account', callback_data: `ra:${id}` }]] })
const undoButton = recordButtons

/** Category choices for a record: the 8 you use most for that kind, two a row (callback sc:<id>:<index>). */
export function categoryKeyboard(state, t) {
  const kind = t.type === 'income' ? 'income' : 'expense'
  const used = {}
  for (const x of state.tx) if (x.type === t.type) used[x.category] = (used[x.category] || 0) + 1
  const all = state.settings.categories
  const cats = all.map((c, i) => ({ c, i })).filter(({ c }) => !c.archived && (c.type || 'expense') === kind && c.id !== t.category)
    .sort((a, b) => (used[b.c.id] || 0) - (used[a.c.id] || 0)).slice(0, 8)
  const rows = []
  for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map(({ c, i: n }) => ({ text: `${c.emoji || ''} ${c.name}`.trim(), callback_data: `sc:${t.id}:${n}` })))
  rows.push([{ text: '‹ Back', callback_data: `rb:${t.id}` }])
  return { inline_keyboard: rows }
}

/** Account choices: active accounts in the record's currency (callback sa:<id>:<index>). */
export function accountKeyboard(state, t) {
  const accs = state.settings.accounts.map((a, i) => ({ a, i })).filter(({ a }) => !a.archived && a.id !== t.account && (a.currency || state.settings.currency) === t.currency).slice(0, 10)
  const rows = []
  for (let i = 0; i < accs.length; i += 2) rows.push(accs.slice(i, i + 2).map(({ a, i: n }) => ({ text: a.name, callback_data: `sa:${t.id}:${n}` })))
  rows.push([{ text: '‹ Back', callback_data: `rb:${t.id}` }])
  return { inline_keyboard: rows }
}

/** Changes one record (category or account), like editing it in the app. Returns {s, t} or null. */
export async function changeRecord(cfg, id, patch, now = Date.now(), fetchImpl = fetch) {
  const cur = await readValue(cfg, fetchImpl)
  const s = state(cur.value)
  const t = s.tx.find((x) => x.id === id)
  if (!t) return null
  Object.assign(t, patch, { updatedAt: now })
  if ('category' in patch) delete t.sub
  delete t.review // fixed from the bot: checked
  await pushCopy(cfg, s, { edited: true, editedAt: now }, now, fetchImpl)
  return { s, t }
}

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
    // Undo all the records of one message; cancel a reminder.
    const all = /^undoall:(\d+)$/.exec(cq.data || '')
    if (all) {
      const cur = await readValue(cfg, fetchImpl)
      const s = state(cur.value)
      const ids = s.tx.filter((t) => String(t.id).startsWith(`tg-${all[1]}-`)).map((t) => t.id)
      for (const id of ids) await removeRecord(cfg, id, now, fetchImpl)
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: ids.length ? `Removed ${ids.length}` : 'Already removed' })
      if (ids.length && cq.message) await call('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: `↩️ Removed ${ids.length} record${ids.length === 1 ? '' : 's'}` })
      return calls
    }
    const rmx = /^rmx:([a-z0-9-]+)$/.exec(cq.data || '')
    if (rmx) {
      await run(cfg, [[T_REM], ['UPDATE sys_bot_reminders SET done = 1 WHERE id = ?', [rmx[1]]]], fetchImpl)
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Reminder cancelled' })
      if (cq.message) await call('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } })
      return calls
    }
    const m = /^(undo|rc|ra|rb|sc|sa):((?:tg-\d+(?:-\d+)?)|(?:ph-[a-z0-9]+))(?::(\d+))?$/.exec(cq.data || '')
    if (!m) { await call('answerCallbackQuery', { callback_query_id: cq.id }); return calls }
    const [, op, id, idx] = m
    const where = cq.message ? { chat_id: cq.message.chat.id, message_id: cq.message.message_id } : null
    if (op !== 'undo') {
      const today = moneyDay(now)
      if (op === 'rc' || op === 'ra' || op === 'rb') {
        const s = state((await readValue(cfg, fetchImpl)).value)
        const t = s.tx.find((x) => x.id === id)
        await call('answerCallbackQuery', { callback_query_id: cq.id, ...(t ? {} : { text: 'That record was removed' }) })
        if (t && where) await call('editMessageReplyMarkup', { ...where, reply_markup: op === 'rc' ? categoryKeyboard(s, t) : op === 'ra' ? accountKeyboard(s, t) : recordButtons(id) })
        return calls
      }
      const cur = state((await readValue(cfg, fetchImpl)).value)
      const pick = op === 'sc' ? cur.settings.categories[Number(idx)] : cur.settings.accounts[Number(idx)]
      const r = pick ? await changeRecord(cfg, id, op === 'sc' ? { category: pick.id } : { account: pick.id }, now, fetchImpl) : null
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: r ? `Changed to ${pick.name}` : 'That record was removed' })
      if (r && where) await call('editMessageText', { ...where, parse_mode: 'HTML', disable_web_page_preview: true, text: loggedText(r.s, r.t, today), reply_markup: recordButtons(id) })
      return calls
    }
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
    else if (cmd === 'reminders') {
      const list = await listReminders(cfg, fetchImpl)
      await reply(list.length ? `⏰ <b>Your reminders</b> (they come in the morning message):\n${list.map((r) => `• ${esc(shortDay(r.due))}: ${esc(r.text)}`).join('\n')}` : 'No reminders. Add one: <code>remind me to pay internet on the 27th</code>', list.length ? { reply_markup: { inline_keyboard: list.slice(0, 10).map((r) => [{ text: `✕ ${r.text.slice(0, 30)}`, callback_data: `rmx:${r.id}` }]) } } : {})
    } else if (cmd === 'remind') {
      const r = readReminder(text, today)
      if (!r) await reply('Write it like: <code>/remind pay internet on the 27th</code>')
      else {
        const id = `rm-${update.update_id}`
        await run(cfg, [[T_REM], ['INSERT OR IGNORE INTO sys_bot_reminders (id, due, text, created) VALUES (?, ?, ?, ?)', [id, r.date, r.text.slice(0, 200), now]]], fetchImpl)
        await reply(`⏰ I'll remind you on <b>${esc(shortDay(r.date))}</b> morning: ${esc(r.text)}`, { reply_markup: { inline_keyboard: [[{ text: '✕ Cancel', callback_data: `rmx:${id}` }]] } })
      }
    }
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

  // A reminder: "remind me to pay internet on the 27th".
  const rem = readReminder(text, today)
  if (rem) {
    const id = `rm-${update.update_id}`
    await run(cfg, [[T_REM], ['INSERT OR IGNORE INTO sys_bot_reminders (id, due, text, created) VALUES (?, ?, ?, ?)', [id, rem.date, rem.text.slice(0, 200), now]]], fetchImpl)
    await reply(`⏰ I'll remind you on <b>${esc(shortDay(rem.date))}</b> morning: ${esc(rem.text)}`, { reply_markup: { inline_keyboard: [[{ text: '✕ Cancel', callback_data: `rmx:${id}` }]] } })
    return calls
  }

  // The same message twice (Telegram retries) is handled once.
  const id = `tg-${update.update_id}`
  const cur = await readValue(cfg, fetchImpl)
  const s = state(cur.value)
  if (s.tx.some((t) => t.id === id || String(t.id).startsWith(`${id}-`)) || s.deleted?.[id]) return calls

  // A question in plain words: "food this month", "and last month?", "can I afford 3000".
  if (isQuestion(text) || /^(when|next|cand|когда)\b/i.test(text)) {
    const prev = await readCtx(cfg, chatId, now, fetchImpl)
    const a = answer(s, text, today, prev)
    if (a) {
      if (a.ctx) await saveCtx(cfg, chatId, a.ctx, now, fetchImpl)
      await reply(a.text)
      return calls
    }
  }

  // Several records in one message: "lunch 120, taxi 45, coffee 30".
  const parts = splitRecords(text)
  if (parts) {
    const read = parts.map((p) => parseQuick(s, p, { today }))
    if (read.every((r) => r.ok)) {
      const made = read.map((r, i) => ({ id: `${id}-${i + 1}`, createdAt: now + i, updatedAt: now, ...r.tx, source: 'telegram' }))
      s.tx.push(...made)
      await pushCopy(cfg, s, { edited: true, editedAt: now }, now, fetchImpl)
      const total = made.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0)
      await reply(`✅ <b>${made.length} records</b>\n${made.map((t) => `• ${t.type === 'income' ? '+' : '−'}${esc(formatMoney(t.amount, t.currency))} · ${esc(t.note || '')}`).join('\n')}${total ? `\nTogether: ${esc(formatMoney(total, s.settings.currency))}` : ''}\n\n${safeLine(s, today, (c) => money(s, c))}`, { reply_markup: { inline_keyboard: [[{ text: '↩️ Undo all', callback_data: `undoall:${update.update_id}` }]] } })
      return calls
    }
  }
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
    { command: 'reminders', description: 'Your reminders' },
    { command: 'help', description: 'How to log and what to ask' },
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

/** Which scheduled messages are on (settings.botMsgs, synced; all on unless turned off). */
export const botMsgs = (state) => ({ morning: true, evening: true, weekly: true, monthly: true, ...(state?.settings?.botMsgs || {}) })

const money = (state, c, cur) => esc(formatMoney(Math.round(c / 100) * 100, cur || state.settings.currency, { reveal: true }))

/** The morning message: Safe to spend, what is due in the next 2 days (subscriptions and bills). */
export function morningText(state, today) {
  const lines = ['☀️ <b>Good morning</b>']
  if (state.tx.length) lines.push(safeLine(state, today, (c) => money(state, c)))
  const subs = subscriptionTable(state, today).rows.filter((x) => x.status !== 'paused' && x.days != null && x.days <= 2)
  const subIds = new Set(subs.map((x) => x.id))
  for (const x of subs) {
    const acc = state.settings.accounts.find((a) => a.id === x.rule.account)
    const when = x.days < 0 ? `was due ${shortDay(x.next)}, not logged yet` : x.days === 0 ? 'due <b>today</b>' : x.days === 1 ? 'due tomorrow' : 'due in 2 days'
    lines.push(`🧾 ${esc(x.name)} ${money(state, x.rule.amount, x.rule.currency)}: ${when}${acc ? ` from ${esc(acc.name)}` : ''}${x.low ? ` ⚠️ ${esc(acc.name)} has only ${money(state, Math.max(0, x.have), x.accCur)}` : ''}`)
  }
  for (const it of [...dueItems(state, today), ...upcomingItems(state, today, 2)]) {
    if (it.rule.type !== 'expense' || subIds.has(it.rule.id)) continue
    lines.push(`📅 ${esc(it.rule.note || 'Bill')} ${money(state, it.rule.amount, it.rule.currency)}: ${it.date < today ? 'overdue' : it.date === today ? 'due <b>today</b>' : `due ${shortDay(it.date)}`}`)
  }
  // A good day to change dollars: today's rate is higher than 75% of the last 90 days, and you hold some.
  const usd = state.settings.currency !== 'USD' ? rateAdvice(state, 'USD', today) : null
  const held = usd?.verdict === 'high' ? heldIn(state, 'USD', accountBalances(state)) : 0
  if (held > 0) lines.push(`💵 Good day to change dollars: 1 USD = <b>${usd.rate.toFixed(2)} ${esc(state.settings.currency)}</b>, higher than ${Math.round(usd.pct * 100)}% of the last 90 days. You hold ${money(state, held, 'USD')}.`)
  // Category budgets at 80% or over (the busiest two).
  for (const r of budgetStatus(state, monthKey(today), today).rows.filter((x) => x.level === 'over' || x.level === 'near').slice(0, 2)) {
    lines.push(r.level === 'over'
      ? `🎯 ${esc(r.category.name)}: over its budget by ${money(state, -r.left)} (${money(state, r.spent)} of ${money(state, r.budget)})`
      : `🎯 ${esc(r.category.name)}: ${Math.round(r.pct * 100)}% of the budget used, ${money(state, r.left)} left for the month`)
  }
  const sl = streakLine(streaks(state, today))
  if (sl) lines.push(sl)
  const tip = smartSteps(state, today)[0]
  if (tip) lines.push(`💡 ${esc(tip.title)}. ${esc(tip.text)}`)
  return lines.length > 1 ? lines.join('\n') : null
}

/** The evening nudge: only when nothing was logged today. */
export function eveningText(state, today) {
  if ((state.tx || []).some((t) => t.date === today || (t.createdAt && moneyDay(t.createdAt) === today))) return null
  const st = streaks(state, today)
  return `🌙 Nothing logged today. Anything to add? Reply like <code>lunch 85</code> or <code>taxi 45 maib</code>.${st.logging >= 3 ? ` Keep your 🔥 ${st.logging}-day streak going.` : ' If you spent nothing, ignore me 🙂'}`
}

/**
 * The scheduled messages (api/cron.mjs): morning = the morning message, plus the week on
 * Sundays and last month's recap on the 1st; evening = the nudge. Only while the
 * always-on bot is on (Telegram sends to this server) and each message is switched on.
 */
export async function runBotJob(cfg, job, { now = Date.now(), fetchImpl = fetch, tgFetch = fetchImpl, env = process.env } = {}) {
  const bot = botConfig(env)
  if (!bot.token || !bot.chat) return { job, sent: 0, skipped: 'not configured' }
  const info = await tg(bot, 'getWebhookInfo', {}, tgFetch).catch(() => null)
  if (!info?.url || !/\/api\/telegram$/.test(info.url)) return { job, sent: 0, skipped: 'bot off' }
  const cur = await readValue(cfg, fetchImpl)
  if (!cur.value?.data) return { job, sent: 0, skipped: 'no data' }
  const s = state(cur.value)
  const on = botMsgs(s)
  const today = moneyDay(now)
  const texts = []
  if (job === 'morning') {
    // Reminders you asked for ("remind me to … on the 27th"): always sent, morning message on or off.
    const due = await takeDueReminders(cfg, today, fetchImpl).catch(() => [])
    if (due.length) texts.push(`⏰ <b>Reminder${due.length === 1 ? '' : 's'}</b>\n${due.map((r) => `• ${esc(r.text)}${r.due < today ? ` <i>(from ${esc(shortDay(r.due))})</i>` : ''}`).join('\n')}`)
    if (on.morning) texts.push(morningText(s, today))
    if (on.weekly && new Date(`${today}T12:00:00Z`).getUTCDay() === 0) texts.push(weeklyText(s, weeklyReview(s, today)))
    if (on.monthly && today.endsWith('-01')) texts.push(recapText(s, addMonths(monthKey(today), -1)))
  } else if (job === 'evening' && on.evening) texts.push(eveningText(s, today))
  let sent = 0
  for (const text of texts.filter(Boolean)) {
    await tg(bot, 'sendMessage', { chat_id: bot.chat, text, parse_mode: 'HTML', disable_web_page_preview: true }, tgFetch)
    sent++
  }
  return { job, sent }
}
