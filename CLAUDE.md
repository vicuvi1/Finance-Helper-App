@AGENTS.md

# Claude Code only

These add to the shared rules above (AGENTS.md is the file Codex and
Antigravity read; change shared rules there, not here).

- **Keep the live preview updated** after UI changes: run
  `node scripts/build-preview.mjs <scratchpad>/preview` and republish the
  artifact (https://claude.ai/artifact/9xnQ9KKaGuE6X8AtrAJAJZ) with
  `index.html`, `css/*`, `js/*`, `icons/icon.svg` and `sample.csv`.
  The preview sets `window.FH_DEMO = true`: example data, no downloads,
  no service worker.
  Publish every file under `js/` (new ones too): one missing module stops
  the whole app and the preview shows only the sidebar.
