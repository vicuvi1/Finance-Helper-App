// What /api/db lets a device send to Turso (A1). The app and the embedded
// apps run their own SQL, so this is a deny-list of the things no page ever
// needs: the server's own tables (PIN, sign-outs, wrong-PIN counters,
// passkeys, devices, job slots), and statements that reach past the data
// (ATTACH, PRAGMA, VACUUM, extensions). Only plain execute/batch/close
// requests pass; stored or multi-statement SQL is refused.

/** Server-only tables: never read or written from a page. */
export const PROTECTED_TABLES = ['sys_auth', 'sys_login_guard', 'sys_passkeys', 'sys_passkey_chal', 'sys_devices', 'sys_gate', 'sys_push', 'sys_kv', 'sys_mcp_tokens', 'sys_mem_vec']
/**
 * The only sys_* tables a page uses (sync bookkeeping and the health log).
 * Every other sys_* name, now or added later, is the server's.
 */
export const PAGE_SYS_TABLES = new Set(['sys_cas', 'sys_writes', 'sys_writes_at', 'sys_table_versions', 'sys_health', 'sys_error_log', 'sys_ben_log'])
/**
 * Settings keys a page may never read or write: the PIN hash lived in settings
 * before it moved to sys_auth, and nothing PIN-derived belongs there again.
 */
export const SECRET_KEYS = ['pin_hash']
const BANNED = new Set(['attach', 'detach', 'pragma', 'vacuum', 'load_extension'])
/** Names that reach past the data: raw pages, page stats and pragma table functions. sqlite_master stays readable: the app copies the schema from it, and the schema is public (this repo). */
const INTERNAL = /^(sqlite_dbpage|dbstat|pragma_\w+)$/
/** The text of a statement's arguments (positional and named). */
const argText = (stmt) => [...(Array.isArray(stmt.args) ? stmt.args : []), ...(Array.isArray(stmt.named_args) ? stmt.named_args.map((a) => a?.value) : [])].map((a) => (a && typeof a === 'object' ? String(a.value ?? a.base64 ?? '') : String(a ?? ''))).join('\n').toLowerCase()
/**
 * Tables a page may only read (LT1): the 30 daily cloud backups and their parts. A stolen
 * session must not be able to wipe or rewrite them; the app saves its daily
 * backup through the server ({snapshot} in api/db.mjs), which only adds.
 */
export const READ_ONLY_TABLES = ['cloud_snapshots', 'cloud_snapshot_parts']
const WRITES = new Set(['insert', 'update', 'delete', 'replace', 'drop', 'alter', 'create', 'upsert', 'truncate', 'reindex'])

/**
 * The words of a statement outside strings, quoted names and comments;
 * null when a quote or comment is never closed (refused).
 */
export function codeWords(sql) {
  const s = String(sql)
  const words = []
  let i = 0
  let word = ''
  const flush = () => {
    if (word) words.push(word.toLowerCase())
    word = ''
  }
  while (i < s.length) {
    const c = s[i]
    const close = c === "'" ? "'" : c === '"' ? '"' : c === '`' ? '`' : c === '[' ? ']' : null
    if (close) {
      flush()
      let j = i + 1
      for (;;) {
        j = s.indexOf(close, j)
        if (j < 0) return null
        if (close !== ']' && s[j + 1] === close) j += 2 // '' "" `` inside
        else break
      }
      i = j + 1
      continue
    }
    if (c === '-' && s[i + 1] === '-') {
      flush()
      const j = s.indexOf('\n', i)
      i = j < 0 ? s.length : j + 1
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      flush()
      const j = s.indexOf('*/', i + 2)
      if (j < 0) return null
      i = j + 2
      continue
    }
    if (/[A-Za-z0-9_$]/.test(c)) word += c
    else flush()
    i++
  }
  flush()
  return words
}

/** Why a statement is refused, or null when it may run. */
export function stmtProblem(stmt) {
  if (!stmt || typeof stmt !== 'object') return 'Bad statement'
  if (stmt.sql_id != null || typeof stmt.sql !== 'string') return 'Only plain SQL is accepted'
  const lower = stmt.sql.toLowerCase()
  // Anywhere, even inside quotes: "sys_auth", [sys_auth] and `sys_auth` all name the table.
  const table = PROTECTED_TABLES.find((t) => lower.includes(t)) ?? (lower.match(/sys_[a-z0-9_$]*/g) ?? []).find((t) => !PAGE_SYS_TABLES.has(t))
  if (table) return `The table ${table} belongs to the server`
  // The PIN hash: never in settings again, never readable or writable from a page.
  const args = argText(stmt)
  if (SECRET_KEYS.some((k) => lower.includes(k) || args.includes(k))) return 'That setting belongs to the server'
  const words = codeWords(stmt.sql)
  if (!words) return 'Unclosed quote or comment'
  const bad = words.find((w) => BANNED.has(w))
  if (bad) return `${bad.toUpperCase()} is not allowed`
  // Quoted names count too ("pragma_table_info", [dbstat]).
  const inner = (lower.match(/[a-z0-9_$]+/g) ?? []).find((w) => INTERNAL.test(w))
  if (inner) return `${inner} is not allowed`
  // Anywhere, like the server tables: a read-only table may appear only in a plain SELECT.
  const ro = READ_ONLY_TABLES.find((t) => lower.includes(t))
  if (ro && (words[0] !== 'select' || words.some((w) => WRITES.has(w)))) return `The table ${ro} can only be read here (backups are saved by the server)`
  return null
}

/** The plain SQL of every statement in a pipeline body. */
const stmtsOf = (body) => (body?.requests ?? []).flatMap((r) => (r?.type === 'execute' ? [r.stmt] : r?.type === 'batch' ? (r.batch?.steps ?? []).map((s) => s?.stmt) : [])).filter((s) => s && typeof s.sql === 'string')

/** True when a pipeline body changes data (anything but reads and BEGIN/COMMIT/ROLLBACK). */
export function pipelineWrites(body) {
  return stmtsOf(body).some((s) => (codeWords(s.sql) ?? ['?']).some((w) => WRITES.has(w)))
}

/** Why a pipeline body is refused, or null when every statement may run. */
export function pipelineProblem(body) {
  if (!body || !Array.isArray(body.requests)) return 'Expected {requests: [...]}'
  if (body.baton != null) return 'Streams are not supported'
  for (const r of body.requests) {
    if (!r || typeof r !== 'object') return 'Bad request'
    if (r.type === 'close') continue
    if (r.type === 'execute') {
      const p = stmtProblem(r.stmt)
      if (p) return p
      continue
    }
    if (r.type === 'batch') {
      const steps = r.batch?.steps
      if (!Array.isArray(steps)) return 'Bad batch'
      for (const step of steps) {
        const p = stmtProblem(step?.stmt)
        if (p) return p
      }
      continue
    }
    return `Request type "${r.type}" is not allowed`
  }
  return null
}
