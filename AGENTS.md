# Finance Helper: rules for every coding agent

Read by Codex and Antigravity (AGENTS.md) and by Claude Code (CLAUDE.md
imports this file). The owner runs several agents on this repo at once,
often from Orca (one git worktree per agent), so these rules are shared.

Personal finance app for one user (MDL, Moldova). Plain HTML/CSS/JS, no build
step, no dependencies for the web app. All math is in `js/model.js` (pure,
tested); `js/app.js` only renders and handles taps.

## Privacy: this repo is PUBLIC
- Never commit the owner's real financial data: no real amounts, notes,
  names, account numbers or screenshots of real data. Real data lives only on
  the owner's devices (and their own Google Drive once sync exists). Use
  made-up data for fixtures, tests, docs and the live preview.

## Working together (several agents, one repo)
- The default branch is `claude/wizardly-mccarthy-wy4oey`. Pushing a new
  version there publishes a release to the owner's installed app.
- Work in your own branch or worktree; merge into the default branch only
  when tests pass. Keep each change small and focused (one feature or fix).
- **Before you push or merge: pull the default branch first**, rebase or
  merge, and run the tests again. Never force-push the default branch.
- **Version numbers:** bump `version` in `package.json`, `package-lock.json`
  and `js/version.js` *in the same commit that lands on the default branch*,
  to one minor above the version already there after pulling (1.49.0 →
  1.50.0; a fix may use the patch number). Never reuse a number: a version
  that was already released publishes nothing.
- Don't redo or undo another agent's recent work without a reason; read
  `git log` first. If two changes touch the same screen, keep both.
- Write commit messages that say what changed for the owner, in plain words.

## Workflow the owner asked for
- **Commit and push after every change**, one focused commit each, so any
  step can be rolled back. Run `npm test` (and `npm run e2e` for UI
  changes) before each push.
- The owner works on the **desktop** app: check and screenshot changes at
  desktop width (1280–1440px) first, then make sure phone width still works.

- **Releases**: raising `version` in `package.json` AND `js/version.js`
  (a test keeps them equal) and pushing to the default branch publishes a
  GitHub Release automatically (`.github/workflows/desktop.yml`). Installed
  desktop apps offer it under Settings → About & updates. Bump the version
  whenever a change should reach the owner's installed app.

## Conventions
- Money is integer bani (1 MDL = 100). Format with `formatMoney`, parse user
  input with `evalAmount` (supports `120+45`).
- Dates are `YYYY-MM-DD` strings, months `YYYY-MM`. No `Date` math in local time.
- Colors only through the CSS tokens in `css/app.css`, defined for light and dark.
- Look B "Midnight premium" (the owner's pick): dark by default (light in Settings), champagne
  gold accent, Fraunces (`--display`, bundled in `fonts/`) for page titles and big figures,
  Geist for text. Home's top: month headline, `homeStrip`, `accountTiles`.
  Extra themes Ocean / Forest / Paper (`settings.theme`) set `data-design` and override tokens.
- Safe to spend today: `js/safespend.js` (pure, tested): cards+cash (`isLiquid`) minus bills
  before the next recurring income (else the 1st) minus this month's savings plan not yet moved
  to savings, over the days left. Home `safeCard`, bot `safeLine` in expense replies and /today.
- No `alert`/`confirm`/`prompt`: confirmations are bottom sheets.
- New app files go in `sw.js` `SHELL` (offline), `build.files` in
  `package.json` (desktop) and `scripts/build-preview.mjs` if outside css/js/icons.
- Desktop: `electron/main.cjs` serves the app from `app://finance`.
  `npm run desktop` to run, `npm run dist` to package. CI builds installers
  (`.github/workflows/desktop.yml`).
- Log screen: List / Table / Calendar (`js/logviews.js`). Table cells save
  on `change`; `renderKeepFocus()` keeps the cursor where the user tabbed to.
- Excel: `js/xlsx.js` writes real .xlsx (stored zip, no deps); sheet contents
  come from `monthSheet` / `overviewSheet` in `js/importer.js`.
- Sync: `js/sync.js` merges per record by `updatedAt` with `state.deleted`
  tombstones; anything new that is edited must call `M.touch()` (settings
  scalars: `settings.updatedAt`). Device-only: `meta`, `rates`, `theme`,
  `logView`. Desktop transport `electron/gdrive.cjs` (Drive API keys) or, the easy way,
  `electron/folder.cjs` (writes into the Google Drive for desktop folder; Drive uploads
  it), web `js/gdrive-web.js`.
- Secrets (Binance key, Google refresh token) live only in the desktop main
  process, encrypted with safeStorage; never in state, never in the page.
- Encryption (optional, Settings → Security): `js/store.js` keeps the data
  sealed (`finance-helper.enc`) plus a header with only the lock fields
  (`finance-helper.head`). Before unlock `ctx.state` is a placeholder
  (`state._sealed`): anything that syncs, backs up or fetches must skip it.
  Sync copies and backups go through `sealForExport` / `backupText`.
- Telegram bot: `electron/telegram.cjs` long-polls the user's own bot (token
  in safeStorage, only the chat linked with the one-time code is heard) and
  acks an update only after the page handled it; parsing and replies are in
  `js/telegram.js`, wiring in `js/screens/telegram.js`. Never commit a token.
  Buttons are blocks (`js/blocks.js`, `settings.tgBlocks`, editor `js/screens/tgblocks.js`).
  Messages older than 2 minutes when handled (PC was off) get one catch-up summary,
  not a reply each; `loadNow()` cuts the long poll short ("📥 From Telegram").
  `e2e/faketelegram.mjs` is a fake Bot API (FH_TG_API) for the desktop e2e bot test.
  When the bot can't work (token revoked, another reader, offline) the app warns on the
  sidebar and Home; a new token for the same bot keeps the linked chat.
  Always on: `electron/relay.gs` is a Google Apps Script the user deploys as a web app in
  their own account (the app writes its random key into the copy). A 1-minute trigger reads
  the bot only while the app hasn't pulled for 90 s, answers and keeps messages (`u_<id>`
  Script Properties); the app pulls/acks every 15 s and sends its offset (`from`) so the
  script never answers what the app handled. Tests run it in a vm (`e2e/appscript.mjs`).
- Calculator: math in `js/calc.js` (pure, no eval), floating panel `js/screens/calc.js`
  (position, open state and tape in localStorage: device-only, never synced).
- End-to-end: `npm run e2e` (`e2e/*.e2e.mjs`, Playwright; on Linux `xvfb-run -a npm run e2e`
  for the desktop test). CI runs it before every desktop build, so a broken app never
  ships. The desktop test uses `FH_USER_DATA` (unpackaged only) for a throwaway data folder.
- Tests: `node --test`. `tests/fixtures/sample-month.csv` is a made-up month
  in the owner's old Google Sheet format (24 465 earned / 6 605 spent).
