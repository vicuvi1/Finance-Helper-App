// Shared bits for the end-to-end tests: a tiny static server for the web
// app and a browser that reports any page error.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.csv': 'text/csv' };

export function serve(dir = ROOT) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
    const file = join(dir, path);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

// Chromium (the one Playwright installed, or PW_CHROMIUM to use another).
export function launch() {
  return chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
}

// A page that keeps every uncaught error, with the network blocked except
// for the app itself (no live rates in tests).
export async function openPage(browser, url, { width = 1366, height = 860 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route((u) => !u.href.startsWith(url), (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, errors, context };
}
