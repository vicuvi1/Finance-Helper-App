// Builds the live preview published on claude.ai from the real app files.
// The preview runs with example data (tests/fixtures/sample-month.csv) and
// without downloads, install prompts or the service worker.
//
//   node scripts/build-preview.mjs <out-dir>

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/build-preview.mjs <out-dir>');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['css', 'js', 'icons', 'fonts']) cpSync(join(root, dir), join(out, dir), { recursive: true });
cpSync(join(root, 'tests/fixtures/sample-month.csv'), join(out, 'sample.csv'));

// The host wraps the page in its own <html>/<head>/<body>, so publish only
// the title, the stylesheet and what is inside <body>.
const html = readFileSync(join(root, 'index.html'), 'utf8');
const title = html.match(/<title>.*?<\/title>/s)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace('<script type="module"', '<script>window.FH_DEMO = true;</script>\n  <script type="module"');
writeFileSync(join(out, 'index.html'), `${title}\n<link rel="stylesheet" href="css/app.css">\n${body.trim()}\n`);
console.log(`preview written to ${out}`);
