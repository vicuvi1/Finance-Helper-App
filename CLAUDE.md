# Finance Helper: notes for Claude

Personal finance app for one user (MDL, Moldova). Plain HTML/CSS/JS, no build
step, no dependencies for the web app. All math is in `js/model.js` (pure,
tested); `js/app.js` only renders and handles taps.

## Privacy: this repo is PUBLIC
- Never commit the owner's real financial data: no real amounts, notes,
  names, account numbers or screenshots of real data. Real data lives only on
  the owner's devices (and their own Google Drive once sync exists). Use
  made-up data for fixtures, tests, docs and the live preview.

## Workflow the owner asked for
- **Commit and push after every change**, one focused commit each, so any
  step can be rolled back. Run `npm test` before each push.
- **Keep the live preview updated** after UI changes: run
  `node scripts/build-preview.mjs <scratchpad>/preview` and republish the
  artifact (https://claude.ai/artifact/9xnQ9KKaGuE6X8AtrAJAJZ) with
  `index.html`, `css/*`, `js/*`, `icons/icon.svg` and `sample.csv`.
  The preview sets `window.FH_DEMO = true`: example data, no downloads,
  no service worker.
  Publish every file under `js/` (new ones too): one missing module stops
  the whole app and the preview shows only the sidebar.

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
  `logView`. Desktop transport `electron/gdrive.cjs`, web `js/gdrive-web.js`.
- Secrets (Binance key, Google refresh token) live only in the desktop main
  process, encrypted with safeStorage; never in state, never in the page.
- Encryption (optional, Settings → Security): `js/store.js` keeps the data
  sealed (`finance-helper.enc`) plus a header with only the lock fields
  (`finance-helper.head`). Before unlock `ctx.state` is a placeholder
  (`state._sealed`): anything that syncs, backs up or fetches must skip it.
  Sync copies and backups go through `sealForExport` / `backupText`.
- Tests: `node --test`. `tests/fixtures/sample-month.csv` is a made-up month
  in the owner's old Google Sheet format (24 465 earned / 6 605 spent).
