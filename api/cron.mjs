// GET/POST /api/cron?job=morning|evening — run by Vercel's scheduler (vercel.json "crons"),
// which sends Authorization: Bearer CRON_SECRET. Morning: the daily backup of Money
// (api/_backups.mjs), then the bot's morning messages. Evening: the bot's evening nudge.
import { config, cronSecretOk, send } from './_lib.mjs'
import { makeBackup } from './_backups.mjs'
import { runBotJob } from './_tgbot.mjs'

export default async function handler(req, res) {
  if (!cronSecretOk(req)) return send(res, 401, { error: 'Only the scheduler' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  const job = new URL(req.url, 'http://x').searchParams.get('job') || 'morning'
  const out = { job }
  try {
    if (job === 'morning' || job === 'backup') out.backup = await makeBackup(cfg, { kind: 'daily' })
  } catch (e) { out.backupError = e.message }
  try {
    if (job === 'morning' || job === 'evening') out.bot = await runBotJob(cfg, job)
  } catch (e) { out.botError = e.message }
  return send(res, out.backupError ? 503 : 200, out)
}
