# Finance Helper: notes for Claude

Personal finance app for one user (MDL, Moldova). Plain HTML/CSS/JS, no build
step, no dependencies for the web app. All math is in `js/model.js` (pure,
tested); `js/app.js` only renders and handles taps.

## Workflow the owner asked for
- **Commit and push after every change**, one focused commit each, so any
  step can be rolled back. Run `npm test` before each push.
- **Keep the live preview updated** after UI changes: run
  `node scripts/build-preview.mjs <scratchpad>/preview` and republish the
  artifact (https://claude.ai/artifact/9xnQ9KKaGuE6X8AtrAJAJZ) with
  `index.html`, `css/*`, `js/*`, `icons/icon.svg` and `sample.csv`.
  The preview sets `window.FH_DEMO = true`: example data, no downloads,
  no service worker.

- The owner works on the **desktop** app: check and screenshot changes at
  desktop width (1280–1440px) first, then make sure phone width still works.

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
- Tests: `node --test`, fixture `tests/fixtures/martie-2026.csv` is the made-up month in the owner's old sheet format (24 465 earned / 6 605 spent).
