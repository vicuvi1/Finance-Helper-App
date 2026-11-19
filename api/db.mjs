// POST /api/db (Bearer session): a Turso pipeline request, sent on with the
// server's Turso key. Server-only tables and statements are refused (_sqlguard.mjs).
// POST /api/db {snapshot: {day, data}} (and {snapshotPart} for each part of a big one): the app's daily cloud backup (LT1). The
// backups are read-only for pages, so this only ADDS today's (never replaces one).
import { pipelineProblem, pipelineWrites } from './_sqlguard.mjs'
import { SCHEMA_VERSION, schemaTooOld } from './_schema.mjs'
import { bearer, config, countCall, readBody, rowsOf, send, requireSession, turso } from './_lib.mjs'
import { saveSnapshot, saveSnapshotPart } from './_snapshots.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  if (!(await requireSession(res, cfg, bearer(req)))) return
  try {
    const body = await readBody(req)
    if (body && body.snapshot) {
      const r = await saveSnapshot(cfg, body.snapshot)
      return send(res, r.status, r.body)
    }
    // A big backup goes in parts, one request each, then its manifest as {snapshot}.
    if (body && body.snapshotPart) {
      const r = await saveSnapshotPart(cfg, body.snapshotPart)
      return send(res, r.status, r.body)
    }

    // Only the app's own data: never the server's tables or ATTACH/PRAGMA (A1).
    const problem = pipelineProblem(body)
    if (problem) return send(res, 403, { error: problem })
    // LT22: a page built before the newest database change may read, but not write.
    if (schemaTooOld(req.headers?.['x-life-schema']) && pipelineWrites(body)) return send(res, 409, { error: 'A new version is out — please reload', reload: true, schema: SCHEMA_VERSION })

    const r = await turso(cfg, body)
    // BG5: only our own session check may answer 401. Turso refusing the
    // server's key (expired, rotated) is a server problem: 503, never a sign-out.
    if (r.status === 401 || r.status === 403) return send(res, 503, { error: 'The database refused the server key: check TURSO_TOKEN in Vercel' })
    // CL2/CL6: counted (calls and rows read), for Settings → System health.
    await countCall(cfg, 'db', rowsOf(r.json))
    send(res, r.status, r.json)
  } catch (e) {
    send(res, 502, { error: e.message || 'Database request failed' })
  }
}
