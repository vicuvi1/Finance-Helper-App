# 💰 Finance Helper

**Know where every lei goes. Keep more of it. Make more of it.**

A personal finance app that replaces the "finance 2026" Google Sheet: the same daily log, the same 70 / 10 / 10 / 10 smart split, the same safe goal. It also does the thinking the sheet couldn't: where the money actually goes, which jar is leaking, which income source pays best, and when you'll hit your goal.

![Home, income split and insights screens](docs/screens.png)

- 📲 **Installs on your phone** like a real app, and works offline.
- 🖥️ **Desktop app** for Windows, Mac and Linux, with a sidebar layout and keyboard shortcuts.
- 🔒 **Private**: no account, no server, no tracking. Your data stays on your device.
- ⚡ **No build step**: plain HTML, CSS and JavaScript.

## What it does

| | |
|---|---|
| ➕ **5-second logging** | Big amount field that works as a calculator (`120+45`). Type a note and the category is picked for you, learning from what you chose before. |
| 🧮 **Smart split** | Every income is split 70% deposit / 10% food & transport / 10% investing & self-development / 10% hygiene & cosmetics (editable). One tap moves the 70% into the Safe. |
| 🫙 **Jars** | Each spending category belongs to a jar. You see live how much is left in each one this month, and what overspent it. |
| 👛 **Wallet, Safe, Card** | Real balances per account, plus moves between them. "All my money" shows on the home screen. |
| 🎯 **Goal with an ETA** | "At 17 860 MDL/month you reach 100 000 in March 2027." It uses your real pace from recent months. |
| 🧠 **Insights** | Savings rate vs your 70% target, overspent jars, categories growing vs a normal month, your biggest expense, small purchases that add up, no-spend days, and the yearly cost of subscriptions. |
| 💸 **Make more** | Income broken down by source (work, family, side jobs, competitions…), with a nudge when one source is all you have. |
| 📅 **Year overview** | The "2026 Overview" tab: earned / spent / kept / % for every month. |
| 📥 **Import your sheet** | Download a month tab as CSV and import it. Dates like `1 martie 2026` and amounts like `2 300MDL` just work. Importing the same month twice is safe. |
| 💾 **Backups** | One-tap JSON backup and restore, plus CSV export. The app reminds you when it's been a while. |

## Use it

### On your phone (recommended)
1. In this repo: **Settings → Pages → Source: GitHub Actions**.
2. Merge to `main`. The *Deploy to GitHub Pages* workflow publishes the app at `https://vicuvi1.github.io/finance-helper-app/`.
3. Open that link on your phone:
   - **Android (Chrome):** Settings tab → *Install*, or the browser menu → *Add to Home screen*.
   - **iPhone (Safari):** Share → *Add to Home Screen*.

> GitHub Pages on a private repo needs a paid GitHub plan. If the repo is private, make it public (your *data* never goes to GitHub, only the app code) or host the folder anywhere that serves static files.

### On your computer (desktop app)
Every push builds the desktop app on GitHub:
1. Open the repo's **Actions** tab → latest **Desktop app** run.
2. Under **Artifacts**, download **Finance-Helper-Windows** (or Linux). Unzip it.
3. Run `Finance-Helper-Setup-x.y.z.exe` to install, or `Finance-Helper-Portable-x.y.z.exe` to run without installing.
   Windows may warn about an unknown publisher (the app isn't code-signed): **More info → Run anyway**.

Push a tag like `v1.0.0` to also build the Mac app and publish all three as a GitHub Release.

Shortcuts: **N** new record · **/** search · **1–4** switch sections · **Esc** close.

> The phone app and the desktop app each keep their own data. To move data between them, use Settings → Back up on one and Restore backup on the other.

### For development
```bash
npm test           # runs the tests (no install needed)
npm start          # serves the web app at http://localhost:5173
npm install        # once, for the desktop tools
npm run desktop    # opens the desktop app
npm run dist       # builds the installer for your OS into dist/
```

## Bring in your Google Sheet
1. Open a month tab (e.g. *Martie*).
2. **File → Download → Comma-separated values (.csv)**.
3. In the app: **Settings → Import Google Sheet (CSV)**. Check the totals match your sheet, then import.
4. Repeat for each month. Categories are guessed from your notes ("food", "gift for sister", "salary"…); tap any record to fix one.

## Your data
Everything is saved in your browser's storage on that device. Clearing the browser's site data deletes it, so **back up** (Settings → Back up) and keep the file somewhere safe, like Google Drive or Telegram *Saved Messages*. To move to a new phone, restore that file there.

## How it's built
```
index.html            app shell and tab bar
css/app.css           styles (light and dark)
js/app.js             screens, add/edit sheet, import/export
js/model.js           all calculations: balances, split, jars, goal, insights
js/money.js           amounts in bani (integers), parsing and calculator
js/dates.js           dates as YYYY-MM-DD, multilingual month names
js/importer.js        Google Sheet / CSV import, CSV export
js/csv.js, charts.js  CSV reader, small SVG charts
sw.js                 offline cache
electron/main.cjs     desktop app window (Electron)
scripts/              live preview build
tests/                node:test, including a made-up month in your old sheet format
```
Money is stored as whole bani, so totals never drift. All the math lives in `model.js` as pure functions, which is what the tests cover.

## License
MIT
