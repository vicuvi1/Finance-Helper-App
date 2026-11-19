// A stand-in for Turso's HTTP pipeline API (/v2/pipeline) on a local SQLite
// file (node:sqlite), for tests and for trying the server locally with
// made-up data. Supports `execute` and `batch` with ok/not/and/or conditions,
// like libSQL. Never points at real data.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const fromHrana = (v) => {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer' || v.type === 'float') return Number(v.value);
  if (v.type === 'blob') return Buffer.from(v.base64 ?? '', 'base64');
  return v.value ?? '';
};
const toHrana = (v) => {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number' || typeof v === 'bigint') return Number.isInteger(Number(v)) ? { type: 'integer', value: String(v) } : { type: 'float', value: Number(v) };
  if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  return { type: 'text', value: String(v) };
};

function runStmt(db, stmt) {
  const s = db.prepare(stmt.sql);
  s.setReturnArrays(true);
  const rows = s.all(...(stmt.args ?? []).map(fromHrana));
  const cols = (s.columns?.() ?? []).map((c) => ({ name: c.name }));
  return { cols, rows: rows.map((r) => r.map(toHrana)), affected_row_count: 0, last_insert_rowid: null };
}

/** Handles one `/v2/pipeline` request body. */
export function handlePipeline(db, body) {
  const results = [];
  for (const req of body.requests ?? []) {
    if (req.type === 'close') results.push({ type: 'ok', response: { type: 'close' } });
    else if (req.type === 'execute') {
      try { results.push({ type: 'ok', response: { type: 'execute', result: runStmt(db, req.stmt) } }); }
      catch (e) { results.push({ type: 'error', error: { message: e.message } }); }
    } else if (req.type === 'batch') {
      const steps = req.batch?.steps ?? [];
      const stepResults = [];
      const stepErrors = [];
      const ok = (c) => {
        if (!c) return true;
        if (c.type === 'ok') return stepResults[c.step] != null;
        if (c.type === 'error') return stepErrors[c.step] != null;
        if (c.type === 'not') return !ok(c.cond);
        if (c.type === 'and') return (c.conds ?? []).every(ok);
        if (c.type === 'or') return (c.conds ?? []).some(ok);
        return true;
      };
      steps.forEach((step, i) => {
        stepResults[i] = null;
        stepErrors[i] = null;
        if (!ok(step.condition)) return;
        try { stepResults[i] = runStmt(db, step.stmt); } catch (e) { stepErrors[i] = { message: e.message }; }
      });
      results.push({ type: 'ok', response: { type: 'batch', result: { step_results: stepResults, step_errors: stepErrors } } });
    } else results.push({ type: 'error', error: { message: `Unsupported request ${req.type}` } });
  }
  return { baton: null, base_url: null, results };
}

/** The tables Money's server code touches, as Life System's schema has them. */
export const BASE_SCHEMA = 'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)';

/** Starts the fake on a free port. `token`: the only bearer it accepts. `down`: answer 500 (a hiccup). */
export async function startFakeTurso({ file = ':memory:', token = 'test-token' } = {}) {
  const db = new DatabaseSync(file);
  db.exec(BASE_SCHEMA);
  const state = { down: false, requests: 0 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.requests++;
      if (state.down) { res.statusCode = 500; return res.end('down'); }
      if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; return res.end('{"error":"bad token"}'); }
      if (req.url !== '/v2/pipeline') { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(handlePipeline(db, JSON.parse(body || '{}'))));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, token, db, state, close: () => new Promise((r) => { server.close(() => { db.close(); r(); }); }) };
}
