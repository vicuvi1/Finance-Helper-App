// POST /api/money (Bearer session): Money's copy on the server (api/_money.mjs).
//   {op:'read'}                 → {raw, sealed, len}  the stored value (a manifest or the whole text)
//   {op:'read', from}           → {slice, len}        a slice of a whole value too big for one answer
//   {op:'parts', ids}           → {parts: {id: text}} pieces of a manifest
//   {op:'has', ids}             → {have: [id]}        which pieces the server already has
//   {op:'upload', parts}        → {n}                 pieces of a big copy, before {op:'push', manifest}
//   {op:'push', text|manifest, edited, editedAt} → {raw, changed, editedAt, restore, sealed}
//   {op:'heal', text}           → {healed}            puts back pieces the server lost
//   {op:'backups'} → {backups}   {op:'backup-now'} → {backup}   {op:'restore', id} → {restored, before}
//   {op:'stats'}                → {moneyChars, pieces, dbBytes, devices}  Data & health
// Our own session check is the only 401; a database problem is a 503 (never a sign-out).
import { bearer, config, readBody, requireSession, send, countCall } from './_lib.mjs'
import { ANSWER_CHARS, hasParts, healCopy, incomingText, moneyStats, pushCopy, readParts, readRaw, readSlice, uploadParts } from './_money.mjs'
import { listDevices } from './_devices.mjs'
import { listBackups, makeBackup, restoreBackup } from './_backups.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  if (!(await requireSession(res, cfg, bearer(req)))) return
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  try {
    const op = body?.op
    let out
    if (op === 'read') {
      if (body.from != null) out = await readSlice(cfg, body.from)
      else {
        const r = await readRaw(cfg)
        const tooBig = r.raw != null && r.raw.length > ANSWER_CHARS
        out = { raw: tooBig ? null : r.raw, len: r.raw?.length ?? 0, sliced: tooBig, sealed: r.sealed }
      }
    } else if (op === 'parts') {
      if (!Array.isArray(body.ids) || body.ids.length > 400) return send(res, 400, { error: 'ids: up to 400' })
      const all = await readParts(cfg, body.ids)
      const parts = {}
      let size = 0
      for (const id of body.ids) {
        const t = all[id]
        if (t == null || parts[id] != null) continue
        if (size && size + t.length > ANSWER_CHARS) break
        parts[id] = t
        size += t.length
      }
      out = { parts }
    } else if (op === 'has') {
      if (!Array.isArray(body.ids) || body.ids.length > 2000) return send(res, 400, { error: 'ids: up to 2000' })
      out = { have: await hasParts(cfg, body.ids) }
    } else if (op === 'upload') {
      out = { n: await uploadParts(cfg, body.parts) }
    } else if (op === 'push') {
      let incoming
      try {
        incoming = JSON.parse(await incomingText(cfg, body))
      } catch (e) {
        return send(res, 400, { error: `Not a Money copy: ${e.message}` })
      }
      out = await pushCopy(cfg, incoming, { edited: !!body.edited, editedAt: Number(body.editedAt) || 0 })
    } else if (op === 'backups') {
      out = { backups: await listBackups(cfg) }
    } else if (op === 'backup-now') {
      out = { backup: await makeBackup(cfg, { kind: 'manual' }) }
    } else if (op === 'restore') {
      if (typeof body.id !== 'string' || !body.id) return send(res, 400, { error: 'Which backup?' })
      out = await restoreBackup(cfg, body.id)
    } else if (op === 'stats') {
      const st = await moneyStats(cfg)
      const dev = await listDevices(cfg).catch(() => ({ devices: [] }))
      out = { ...st, devices: dev.devices }
    } else if (op === 'heal') {
      out = await healCopy(cfg, body.text)
    } else {
      return send(res, 400, { error: 'Unknown op' })
    }
    await countCall(cfg, 'money')
    send(res, 200, out)
  } catch (e) {
    const msg = String(e?.message || e)
    if (/piece|parts/i.test(msg)) return send(res, 409, { error: msg, damaged: true })
    if (/Not a Money copy/.test(msg)) return send(res, 400, { error: msg })
    send(res, 503, { error: `Database not reachable: ${msg.slice(0, 200)}` })
  }
}
