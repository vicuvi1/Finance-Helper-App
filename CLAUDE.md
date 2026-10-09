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

## Conventions
- Money is integer bani (1 MDL = 100). Format with `formatMoney`, parse user
  input with `evalAmount` (supports `120+45`).
- Dates are `YYYY-MM-DD` strings, months `YYYY-MM`. No `Date` math in local time.
- Colors only through the CSS tokens in `css/app.css`, defined for light and dark.
- No `alert`/`confirm`/`prompt`: confirmations are bottom sheets.
- Bump `CACHE` in `sw.js` is not needed (network-first), but add new files to
  its `SHELL` list so they work offline.
- Tests: `node --test`, fixture `tests/fixtures/martie-2026.csv` is the made-up month in the owner's old sheet format (24 465 earned / 6 605 spent).
