// The web app and its server functions (api/*.mjs) on one local port, the way
// Vercel serves them: static files from the app folder, /api/<name> to
// api/<name>.mjs. For tests and local tries (with e2e/faketurso.mjs).
//   node e2e/devserver.mjs            (made-up data in a throwaway database)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const FUNCTIONS = new Set(['login', 'db', 'money', 'telegram', 'cron', 'calendar']);

export async function startDevServer({ port = 0, env = {} } = {}) {
  Object.assign(process.env, env);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const fn = url.pathname.match(/^\/api\/([a-z-]+)$/)?.[1];
    try {
      if (fn) {
        if (!FUNCTIONS.has(fn)) { res.statusCode = 404; return res.end('{}'); }
        const mod = await import(pathToFileURL(join(root, 'api', `${fn}.mjs`)).href);
        return await mod.default(req, res);
      }
      let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!path) path = 'index.html';
      if (/^(api|electron|server|tests|e2e|node_modules|\.git)([/\\]|$)/.test(path)) { res.statusCode = 404; return res.end(); }
      const file = join(root, path);
      if (!file.startsWith(root) || !(await stat(file).catch(() => null))?.isFile()) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { startFakeTurso } = await import('./faketurso.mjs');
  const t = await startFakeTurso();
  const s = await startDevServer({ port: Number(process.env.PORT) || 5173, env: { TURSO_URL: t.url, TURSO_TOKEN: t.token, CRON_SECRET: 'local-setup-key' } });
  console.log(`Web app with its server on ${s.url} (throwaway database; first PIN setup key: local-setup-key)`);
}
