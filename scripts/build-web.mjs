#!/usr/bin/env node
// The web app as Vercel serves it: only the app's own files go into web-dist/
// (never electron/, server/, tests/ or the repo's other files). The server
// functions in api/ are built by Vercel from the repo itself.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web-dist');
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'fonts'];
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f), { recursive: true });
console.log(`Web app copied to ${out}`);
