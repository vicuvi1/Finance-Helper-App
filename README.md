# 💰 Finance Helper

**Know where every lei goes. Keep more of it. Make more of it.**

A personal finance app that replaces the "finance 2026" Google Sheet: the same daily log, the same 70 / 10 / 10 / 10 smart split, the same safe goal. It also does the thinking the sheet couldn't: where the money actually goes, which jar is leaking, which income source pays best, and when you'll hit your goal.


- 📲 **Installs on your phone** like a real app, and works offline.
- 🖥️ **Desktop app** for Windows, Mac and Linux, with a sidebar layout and keyboard shortcuts.
- 🔒 **Private**: no account, no server, no tracking. Your data stays on your device.
- ⚡ **No build step**: plain HTML, CSS and JavaScript.

## What it does

| | |
|---|---|
| ➕ **5-second logging** | Big amount field that works as a calculator (`120+45`). Type a note and the category is picked for you, learning from what you chose before. |
| ⚡ **Quick picks** | Things you log again and again (the bus, your coffee) and your ★ favorites appear as one-tap chips on Home and in the new-record sheet: tap, Enter, done. On the desktop **Ctrl+Alt+N** opens a new record from any app; on the phone, long-press the app icon for **Spent** / **Earned**. |
| 🏷️ **Category rules** | "Description contains *linella* → Food": your rules file new records and bank imports. The app also learns words your records always file the same way, and when you change a record's category it offers to make a rule and move the similar ones. |
| 🤖 **Telegram bot** | Your own private bot (no server): send `coffee 35`, `taxi 45 cash` or `+500 salary`, or tap your usual things on the buttons, and it's logged in the app with an Undo button. /today, /balance, /undo. Evening "time to log" reminder and a morning note when a bill is due. The desktop app reads the bot (it can keep running in the tray and start with the computer); messages sent while the PC was off are logged at the next start. |
| 🗓 **Weekly money ritual** | Every Sunday evening (your day and time) the bot sends your week: kept % vs your target, spending vs a usual week, the biggest leak, and buttons to file records left in "Other". Then a **cash check**: send what's in your wallet (`1240`) and the difference is logged as untracked cash, so balances stay true. Also /review and /cash any time, and "Count cash" on a cash card in the app. |
| 🤖 **Bit, your buddy** | A little flying robot in the corner: cheers when you log, warns when a budget goes over or a big expense lands, celebrates income, streaks and goal milestones, and tells you how the month is going when you click it. Rename it, pick its color, make it quieter, or hide it in Settings. |
| ⏱ **Price in work hours** | Every expense also shows what it cost in your work time: "≈ 3,5 h of your work" while you type it, under Spent each month, in Bit's comments and the Telegram bot's replies. Your hour is worked out from paid invoices with hours, or your income over the hours you work, or set by you (Settings → Your hour). |
| 💵 **Convert USD now?** | Rates shows where today's dollar rate sits in the last 90 days (a line with the average), says when it's a good day to convert or a low one, and what the dollars you hold are worth today vs the average. Home tells you on a good day. The desktop app fills in the last 90 days from the National Bank of Moldova the first time and saves the rate every day after. |
| 🧮 **Smart split** | Every income is split 70% deposit / 10% food & transport / 10% investing & self-development / 10% hygiene & cosmetics (editable). When money comes in (or an invoice is paid) the split sheet opens: set a % for **taxes** first, pick where each part goes (Safe, a tax account, or it stays), and one tap makes all the moves. It remembers your choices; open it again from any income with **Split**. |
| 🫙 **Jars** | Each spending category belongs to a jar. You see live how much is left in each one this month, and what overspent it. |
| 📈 **Net worth over time** | Accounts → Net worth: a line of everything you own month by month, with the change since last month and over the year. History is rebuilt from your records; from now on a snapshot is saved every day (crypto and that day's rates included) and synced. |
| 💳 **Your cards** | Every account looks like a real card: your bank's name or logo (upload any image), a color theme or your own color, the chip, the last 4 digits and the balance. Click a card for this month's in/out, its records, and to edit everything. |
| 👛 **Wallet, Safe, Card** | Real balances per account, plus moves between them. "All my money" shows on the home screen. |
| 🎯 **Goals** | Several goals (emergency fund sized to 6 months of your spending, car, trip…), each with a glowing ring that fills by itself from all your money, your savings accounts, one account, or money you add by hand. Milestones at 25/50/75/100% with confetti, an ETA at your pace, what a deadline needs per month, and a line of encouragement. |
| 🎯 **Goal with an ETA** | "At 17 860 MDL/month you reach 100 000 in March 2027." It uses your real pace from recent months. |
| 🧠 **Insights** | Savings rate vs your 70% target, overspent jars, categories growing vs a normal month, your biggest expense, small purchases that add up, no-spend days, and the yearly cost of subscriptions. |
| 💸 **Make more** | Income broken down by source (work, family, side jobs, competitions…), with a nudge when one source is all you have. |
| 📊 **Table view** | The month as a spreadsheet: edit any cell and it saves, **Enter** moves down a row, sort by any column, type new rows at the bottom. Tick rows (Shift+click for a range) to change their category, account or date, or delete them, all at once. |
| 🔎 **Search all months** | Type in Log's search box: words (`coffee`, `maib`, a category or a person), amounts (`>1000`, `<50`, `100-500`, `35`), dates (`march`, `mar 2025`, `today`) and types (`spent`, `earned`) mix freely. You get how many, how much in total, per month, and when it first and last happened. |
| ↶ **Undo everything** | **Ctrl+Z** undoes any change (an edit, a delete, a bulk change, an import, a setting) and **Ctrl+Y** redoes it, as many steps back as you like; also the ↶ ↷ buttons on Log. |
| 🗓️ **Calendar view** | The month as a calendar with what came in and went out each day, weekly totals, and darker days where you spent more. |
| 📤 **Excel in and out** | **Copy table** and paste into Excel or Google Sheets; paste rows from them back in to import. **Export month** or **Export to Excel** gives a real `.xlsx` with one tab per month, a year overview, live SUM formulas and filters. |
| 📅 **Year overview** | The "2026 Overview" tab: earned / spent / kept / % for every month. |
| ✨ **Year in review** | Reports → Year in review: what you kept, earned and spent vs last year, your best and priciest month, where most money went, your main income and top client, the biggest expense, logging streaks, net worth change and goals reached, with all 12 months as bars. |
| 🧾 **Income for taxes** | On the same page: every income of the year (loans and moves left out) in your currency at each day's rate, by currency, source and payer, and **Export for taxes**: an Excel file with a summary and every income with its date, payer, original currency, rate and amount. |
| 📥 **Import your sheet** | Download a month tab as CSV and import it. Dates like `1 martie 2026` and amounts like `2 300MDL` just work. Importing the same month twice is safe. |
| ✅ **Import check** | Right after importing your sheet, each tab's own totals (its PROFIT / SPENT cells, a total row, or the columns added up) next to what's now in the app, and the exact rows that explain any difference (e.g. a row with an amount but no date). Import the same file again any time to re-check; Settings → Your data → Last import check. |
| 🔁 **Recurring & bills** | Rent, subscriptions, salary, a client who pays monthly: the **Plan** screen shows what's due and the next 30 days, your regular costs per month, and spots payments that look regular in your log. One tap logs a bill; fixed ones can log themselves. Tick **Repeat** when adding a record. |
| 🔮 **Cash-flow forecast** | Plan → forecast for 30, 60 or 90 days: your cards and cash day by day with recurring bills and income, unpaid invoices and your usual daily spending. It shows the lowest point and warns on Home if money would run short before the next income. |
| 🧾 **Budgets** | A monthly limit per category (with your 3-month average as a hint). Bars show what's used and where an even pace would be; you get a warning at 80%, when you go over, and when your pace would take you over. |
| 🏦 **Bank statements** | Import the CSV or Excel statement from maib, Victoriabank or any bank. The app finds the headings (Romanian, Russian or English), the date, amount or debit/credit and description columns, shows a preview with totals, and remembers the layout next time. Statements already imported are skipped. |
| 💼 **Clients & invoices** | Invoices in USD or any currency (hours × rate or fixed lines), numbered INV-2026-001…, printed or saved as PDF with your details. Draft → sent → paid; when the money lands, mark it paid and the income is logged in that account (after fees). Per client: paid this year, per month, and what an hour of your work really earned in lei. |
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
1. Open the repo's **Releases** (right side of the GitHub page) and download **Finance-Helper-Setup-x.y.z.exe** from the newest release.
2. Run it once. Windows may warn about an unknown publisher (the app isn't code-signed): **More info → Run anyway**.
3. From then on, updates are one click: **Settings → About & updates → Check for updates → Update now → Restart to update**. The app also checks by itself at start and every few hours, and shows a banner on Home when a new version is ready.

The portable `.exe` runs without installing, but can't update itself.

Shortcuts: **N** new record · **/** search · **1–7** sections · **L** lock · **Esc** close.

### Sync between devices (Google Drive)
Everything is stored on each device (fast, works offline). Your own Google Drive keeps them in step: **Settings → Google Drive sync**. The app uses Drive's hidden app folder and can't see your other files. The one-time setup (about 5 minutes) is shown step by step in that card: create a Google Cloud project, enable the Drive API, publish the consent screen, create an OAuth client (Desktop app for the PC, Web application with origin `https://vicuvi1.github.io` for the phone), paste the IDs. Syncs at start, a few seconds after each change, every 5 minutes and when the internet returns. PIN, theme and the Binance key never leave the device.

**Encrypt my data** (Settings → Security, after setting a PIN) scrambles everything with your PIN (AES-256): on the device, in the Drive copy and in backups. Use the same PIN on every device. A forgotten PIN can't be recovered, so write it down somewhere safe.

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
