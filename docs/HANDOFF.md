# Finance Helper: handoff for the next session

Read this, then `AGENTS.md`. The owner now works only on this standalone app (no Life System).

**1.89.0: always-on Telegram bot on the server** (`api/telegram.mjs`, `api/_tgbot.mjs`,
`tests/tgbot.test.js`): turn it on in Settings → Telegram & Binance (needs Cloud sync).
**1.88.0: Forgot your PIN?** resets the server PIN with the setup key (CRON_SECRET).

**Since 1.85.0: Life System is frozen.** The files copied from it are this repo's own and are
edited directly; `npm run sync-from-mega` is no longer used (it would undo those edits).

## What the app is now (v1.84.0)
Finance Helper ("Money") is a personal finance app for one person (MDL, Moldova): plain
HTML/CSS/JS, no build step, offline first. It runs as:
- **Desktop** (Electron, Windows installer from GitHub Releases; one-click updates);
- **Web** (served by the owner's Vercel project, with a small server for sign-in and sync);
- both kept in step through **your own server**: Vercel functions + the owner's Turso database.

Since 1.84.0 the web app is the newest Money app from the Life System monorepo
(vicuvi1/mega-system, `src/renderer/public/apps/finance/`) plus the standalone pieces below.

### MEGA commits included
- Copied from MEGA `origin/main` **0d94e87** ("Money: a reality check every 2 weeks compares each
  account with your bank and finds what is wrong"); see `docs/MEGA_SYNC.json`.
- That includes 4278013 / 44217b9 (Money's main data in IndexedDB, `js/bigstore.js`, with the
  verified migration from localStorage) and b997b98 / 0a9f942 (big copies in pieces, sync copies
  in IndexedDB).
- To bring later MEGA work: `git -C ../MEGA-SYSTEM fetch origin main && npm run sync-from-mega`
  (copies the web app, re-applies `scripts/standalone-patches.mjs`, copies MEGA's api helpers,
  re-ports MEGA's Money tests), then `npm test`, `npm run e2e`, bump the version, commit.
  A patch whose text MEGA changed stops the copy with its name: update its `find`.

## Features (short)
Everything MEGA's Money has: logging with calculator amounts, categories + subcategories, rules
and learning, accounts and card designs, transfers, splits, refunds, "not income", repeating
records and bills, budgets (monthly, weekly, yearly, trips, tags) with warnings, income sources
and the salary watch, jars, Safe to spend today, spending limit, pay yourself, goals and
allocations, net worth, rates (BNM) and USD advice, invoices/clients, people and loans, reports,
year in review, taxes, long view, wishlist / can I afford it, archive of old years, change
history with undo, reality check (every 1/2/4 weeks, with explanations and a suspicious-record
guard), privacy (amounts hidden on open, Space toggles), encryption with a PIN, backups
(desktop folder, Google Drive), Google Drive sync, Telegram bot (desktop + own bot server),
Binance balances, Excel/CSV in and out, bank statement import.

Standalone additions (1.84.0):
- **Cloud sync** (Settings → Data & backups): sign in with the server PIN; the newest edit of
  each record wins, deletions stick, nothing else removed; offline edits wait and go as one send;
  confirmed only when the server answered with what it holds; lost pieces are healed.
- **Import from Life System** (same page): Life's Data center Money download (plain or locked),
  a Finance Helper backup, Life's full backup, or a synced copy; preview, backup first, merge.
- **Updates**: Settings → About & updates says "Up to date (vX)", "Downloading 42%",
  "Restart to update", errors in plain English; a button by the app's name shows when an update
  is available / downloading / ready. Web: "Reload to update" when a new version took over.
- **Notifications** on the device (desktop system notifications through the preload, or the
  browser's): budget 80% / 100%, salary or income source late/low, reality check due and 2 days
  later; at most 4 a day, no amounts while amounts are hidden.

## Architecture
```
index.html, css/, js/, sw.js, icons/, fonts/   web app (copied from MEGA + patches)
js/standalone.js     cloud card, sign-in sheet, Life import UI, update badge, notifications runner
js/cloud.js          sync engine (pure apart from injected transport/store/app; tests/cloud.test.js)
js/parts.js          Life's piece format (hash64, splitText, manifest) shared by client and server
js/lifeimport.js     reading Life files, preview, merge (tests/lifeimport.test.js)
js/notifier.js       which notices are due (tests/notifier.test.js)
js/screens/updates.js, js/version.js   standalone-owned (never copied from MEGA)
electron/            desktop main process: updater, cloud-request + notify IPC, Drive/folder/
                     Telegram/Binance; preload exposes window.desktop
api/login.mjs, api/db.mjs, api/_lib.mjs, _sqlguard, _schema, _devices, _push, _passkey,
  _snapshots         MEGA's server code, copied verbatim by the sync script
api/money.mjs, api/_money.mjs   Money's sync endpoint (this repo's own)
server/              the Telegram bot server (Docker), unchanged
vercel.json, scripts/build-web.mjs   Vercel: static web-dist/ + 3 functions
e2e/faketurso.mjs, e2e/devserver.mjs  local Turso stand-in (node:sqlite) + Vercel-like server
```
Desktop requests to the server go through the main process (`cloud-request` IPC: https only,
only /api/login and /api/money), so no CORS is needed. The web app calls its own origin.

### Server API (POST, Bearer session)
`/api/login` {pin} | {setup, pin} (first PIN, needs CRON_SECRET or PIN_SETUP_SECRET) | {renew} |
{changePin} | {signOutAll} | devices/passkeys. `/api/db` Turso pipeline with `_sqlguard`.
`/api/money` ops: read, read slice, parts, has, upload, push (server-side merge in a CAS
transaction, retried on conflict), heal.

## Storage
- **Money's main data**: IndexedDB (MEGA 4278013 `js/bigstore.js`, deviceStorage()), migrated
  once from localStorage `finance-helper.state`; the encrypted box `finance-helper.enc` and
  header `finance-helper.head` as before.
- **Cloud sync bookkeeping**: localStorage `finance-helper.cloud` (url, session, seen editedAt,
  dirty time, last ok). The session is a signed token (14 days, renewed while used); the PIN is
  never stored. Piece cache: memory only.
- **Server**: `settings.app_sync_finance` = `{savedAt, editedAt, data, restore?}` (data = the
  shared form: `toCloud(state).data`, device-only settings removed); over 100 000 characters it is
  a manifest `{"lifeParts":1,...}` with pieces in `setting_parts(key,id,data,at)`. Every write also
  moves `sys_table_versions` and `settings.data_version`, so Life devices notice.
  `app_sync_finance_sealed` (Life's PIN-locked copy) is only reported, never read.

## Data rules
- Merge = `js/sync.js mergeStates`: per record by `updatedAt`, tombstones in `state.deleted`,
  settings key by key (`settingstamp.js`), lists by id. Anything edited must call `M.touch()`.
- The shared copy drops unknown top-level keys: only settings, tx, people, recurring, invoices,
  netWorth, goals, goalAllocations, reconciliations, deleted, lastRates travel (toCloud). A new
  top-level list must be added to `toCloud` and `mergeStates`, or it never syncs.
- Device-only: meta, rates, theme, themeMotion, logView, the cloud bookkeeping, the privacy setting.
- Import from Life never applies the file's deletions and never removes local records.
- Money is integer bani; dates are `YYYY-MM-DD` strings.

## Privacy and security
- Public repo: made-up data only (tests, fixtures, docs, preview).
- Server PIN only in `sys_auth` on the server; no default PIN; wrong-PIN limits (5 per device then
  doubling waits, 20 for everyone then max 15 min); `/api/db` refuses `sys_*` (except sync
  bookkeeping), PRAGMA/ATTACH/VACUUM/extensions, the old `pin_hash` key; backups read-only.
- A database problem is a 503 (the app keeps its session); only our own session check says 401.
- Secrets (Binance key, Drive token, bot token) stay in the desktop main process (safeStorage).
- Amounts hidden on open (Space shows); notifications hide amounts while hidden.

## Tests and commands
- `npm test`: node --test, `tests/*.test.js` (this repo) + `tests/mega/*.test.ts` (416 tests
  ported from MEGA with `tests/mega/_vitest.js`; tests needing Life code are left out and marked).
  Includes the server end to end against node:sqlite (`tests/cloud.test.js`), API guards,
  Life piece format pinned to Life's own values (`tests/parts.test.js`).
- `npm run e2e` (Playwright; `xvfb-run -a` on Linux; `PW_CHROMIUM=/path/to/chrome` if the
  download is blocked): web, goals, desktop window + bot, `e2e/cloud.e2e.mjs` (sign in, sync web →
  desktop-like client, Life import).
- `npm run web`: the web app + server on a throwaway database (setup key `local-setup-key`).

## Release process
Bump `version` in package.json, package-lock.json and js/version.js (minor), push to the default
branch `claude/wizardly-mccarthy-wy4oey`: `.github/workflows/desktop.yml` runs e2e, builds
Windows + Linux and publishes the GitHub Release with `latest.yml` (electron-updater reads it;
`build.publish` = github vicuvi1/Finance-Helper-App). Never reuse a version. Watch with
`gh api repos/vicuvi1/Finance-Helper-App/actions/runs --jq '.workflow_runs[0:3][]|[.name,.status,.conclusion]'`.

## Switching the Vercel project "mega-system" to this repo (NOT done yet)
Settings to change in Vercel (project mega-system, domain mega-system-ten.vercel.app):
1. Git → connect repository `vicuvi1/Finance-Helper-App`, production branch
   `claude/wizardly-mccarthy-wy4oey`.
2. Build & Output: Framework Preset **Other**; Root Directory **./** (empty); Install Command
   `npm ci --omit=dev --ignore-scripts`; Build Command `node scripts/build-web.mjs`; Output
   Directory `web-dist` (all also in vercel.json, which wins). Node.js version 22.x.
3. Functions: `api/login.mjs`, `api/db.mjs`, `api/money.mjs` (3 of 12). No crons.
4. Environment variables: keep them as they are. Used: `TURSO_URL`/`TURSO_DATABASE_URL`,
   `TURSO_TOKEN`/`TURSO_AUTH_TOKEN`, `SESSION_SECRET` (if set; else derived from the token, same
   as MEGA, so existing sessions stay valid), `CRON_SECRET` / `PIN_SETUP_SECRET` (first PIN only).
5. After the deploy: open the site, sign in with the same PIN; Money loads from the database.

What Life System loses when the project switches (Life's desktop keeps `/api/login` and
`/api/db`, so its database sync and daily cloud backup keep working):
- the Life website at `/` (replaced by Money) and its pages under `/apps/`, `/widgets/`;
- `/api/telegram` (all Telegram bots stop answering: webhooks point at a missing function),
  `/api/cron` (morning/midday/evening bot messages, the weekly off-site backup download),
  `/api/ai`, `/api/coach`, `/api/config` (bot defaults, push keys), `/api/google` (+callback),
  `/api/todoist`, `/api/mcp` and `/.well-known` OAuth for MCP, `/api/bot-setup`, `/api/bot-health`;
- web push notifications; Life's security headers for its own pages.
Life's GitHub off-site backup workflow (calls /api/cron?job=backup) will fail after the switch.

## Open risks (standalone)
1. One JSON copy per device: big data costs CPU on each merge (~0.3 s at 12k records, ~0.9 s at
   36k, on the main thread). Skip-when-unchanged exists on the server (canonical compare); a worker
   is not done.
2. `/api/money` push sends the whole shared copy (in pieces when big) each time something
   changed; fine for one person, wasteful with many devices.
3. Tombstones (`state.deleted`) are never pruned.
4. Server PIN can be 4 digits; lockout tops out at 15 minutes for everyone (owner asked not to
   force longer PINs yet).
5. Life's PIN-locked cloud copy (`app_sync_finance_sealed`) is not read: if Money was locked in
   Life, the plain server copy may be old. Unlock in Life (or import the locked file) first.
6. Node 22 end of life 2027-04-30; Electron 33 in this repo is old (MEGA uses 45). Unsigned
   Windows builds (SmartScreen warning).
7. Single hostname `mega-system-ten.vercel.app` hardcoded as the desktop default (configurable
   in Settings → Cloud sync); a custom domain would remove that.
8. The first web visit with nothing stored asks for the PIN; on a shared computer, sign out after.
9. Deletions of records made before tombstones existed can't be told apart from "never had it".

## What still lives only in MEGA
Telegram bots on Vercel (webhooks, finance bot texts, inbox), crons, the AI coach, Life's
notification budget and bell, moneyHub (Life's hub cards), receipts (Google Drive receipts via
Life), points/rewards purchases, the Data center, Life's mirror/appSync and its tests
(appSyncSkip, bigStore, moneyAuditFixes, moneyFixes, moneyLockedSync, moneyScale, moneySort,
moneyStore, moneySyncHeal), Life's sealed-copy sync of a locked Money.
