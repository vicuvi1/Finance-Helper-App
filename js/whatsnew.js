// "What's new": after the app updates, a short note says what changed, in
// plain words. Shown once per update (meta.whatsNewSeen, this device only),
// and any time from Settings → About & updates. Add a line here with every
// release that changes something you can see (newest first).

import { isNewerVersion } from './version.js';

export const NOTES = [
  { v: '1.116.0', items: ['Always-on bot: under each saved record (typed, or from your phone) there are now 🏷 Category and 💳 Account buttons next to Undo. Pick the right one and the record changes everywhere; the next payment at the same shop gets that category.'] },
  { v: '1.115.0', items: ['New record: the Add button stays at the bottom of the form, always in view (desktop and phone).', 'Log → Sheet: plain English (Spent, Earned, Day net, English months and days) and every column fits on screen.', 'Home says things once: late bills only in To confirm, the emergency fund only once.', 'Screen tips look like tips again.'] },
  { v: '1.114.0', items: ['Planned big expenses: once paid (found in your records by name and amount, or press Paid), the money is no longer kept back from Safe to spend.', 'Planned expenses and closed months added on two devices before they sync are both kept.', 'A few settings (work hour, wallpaper) and changes from Google Drive now reach your other devices right away.', '"Money runs low" no longer counts a subscription you stopped paying long ago, or a future move into savings.'] },
  { v: '1.113.0', items: ['Fixes: a record added while a sync was running could be lost; edits in the Log table and the automatic salary now reach your other devices; a new device signing in after a server restore merges instead of replacing; "12 nov 4500 rent" is 4 500 on 12 Nov; Close the month no longer suggests archiving accounts that still hold money; the Subscriptions table\'s next payment works for "on the 5th" payments; emoji in long bill names show right in Google Calendar.'] },
  { v: '1.112.0', items: ['Payments recorded by themselves from your phone: Settings → Data & backups → Cloud sync → 📲 Record payments automatically. iPhone: a Shortcuts automation when you pay with Apple Pay. Android: MacroDroid forwards your bank\'s notification or SMS. Amount, shop and card are read for you; the same payment twice is saved once, and the bot tells you with Undo.'] },
  { v: '1.111.0', items: ['Your Money in Google Sheets, kept up to date by itself: Settings → Data & backups → Server backups → 📊 Copy in Google Sheets gives one line to paste in a sheet (every record, and month by month). No Google sign-in needed.'] },
  { v: '1.110.0', items: ['Web app: sign in with your fingerprint, face or Windows Hello instead of the PIN. Turn it on in Settings → Data & backups → Cloud sync → 👆 Sign in with fingerprint (the PIN keeps working). Remove it any time under Devices.'] },
  { v: '1.109.0', items: ['Desktop: hover the Finance Helper icon by the clock (or right-click it) to see Safe to spend today without opening the app.', 'Settings → Data & backups → Cloud sync → 📱 On your phone: the address to open and how to add Money to your phone\'s home screen (Android and iPhone).'] },
  { v: '1.108.0', items: ['Faster with lots of data: when nothing changed on either side, the sync every minute is one small check instead of re-merging everything (tested with 20 000 and 40 000 records).'] },
  { v: '1.107.0', items: ['Bank statement import: rows you already logged yourself (same amount within 2 days, any note) start unticked, showing your record; categories come from what you chose before for that shop, and guesses are marked ? so you check only those.'] },
  { v: '1.106.0', items: ['Streaks: 🔥 days in a row you logged something, and 🌱 no-spend days, in Reports → Your spending habits and in the bot\'s messages ("Keep your 12-day streak going").', 'Money wrapped: at the end of a month recap, "Share as a picture" makes one image of your month (amounts only if you tick them) to save or share.'] },
  { v: '1.105.0', items: ['Close the month in 5 minutes: from the 1st to the 15th, "Do this next" offers a checklist for last month (accounts, "Other", subscriptions, recap), then marks it ✓ checked. Also in the Log on past months.', 'Clean-up suggestions in that checklist: categories you never use, subscriptions you may have cancelled, accounts with no records for 6 months, each with one tap (or "Keep it").'] },
  { v: '1.104.0', items: ['Log table: ＋ (or a click on a day\'s name) opens a line right in that day: type "120 lunch maib", Enter saves, with a preview of what it will be. "Form…" opens the full form.', 'The column titles and the day you\'re in stay on top while you scroll.', 'A line after each week: what it cost, against a usual week.', 'Tick several records and drag one: they all move to that day.', 'Moves without a note show what they are: To savings, Cash withdrawal, Exchange USD → MDL…'] },
  { v: '1.103.0', items: ['Log table: every day of the month is listed, even days with nothing logged, each with a ＋ to add a record on that day.', 'Drag a record by its ⠿ handle onto another day to move it there (Undo works).', 'Settings → About & updates → Update history: every version and what it brought.'] },
  { v: '1.102.0', items: ['"Money runs low around 28 Nov": a warning in "Do this next" (and the bot\'s morning message) when bills would take your cards and cash under the money you want to keep.', 'Can I afford it? now says when, if not this month: "In about 4 months (March) if you keep saving like the last 3 months".'] },
  { v: '1.101.0', items: ['Plan → 🗓️ Planned: big expenses coming (insurance, a holiday) spread over the months until then; Safe to spend keeps that money aside.'] },
  { v: '1.100.0', items: ['Plan → Subscriptions → 📅 Add to Google Calendar: every bill and subscription on its day, with a reminder the evening before.'] },
  { v: '1.99.0', items: ['Settings → Data & backups → Cloud sync: Change PIN, and Devices (sign out one you no longer use).', 'The bot\'s morning message says when it\'s a good day to change dollars (you hold USD and the rate is high).'] },
  { v: '1.98.0', items: ['Reports → Your spending habits: which weekdays cost the most ("Fridays cost you 2× a normal day") and when in the day you spend.'] },
  { v: '1.97.0', items: ['"What\'s new" like this one, once after each update (and any time in Settings → About & updates).'] },
  { v: '1.96.0', items: ['Reports → 📄 Report: any month or year as Excel or PDF.', 'Reality check shows a small picture of each account\'s card, so you type into the right one.', 'Data & health shows whether this device locks itself when you step away.'] },
  { v: '1.95.0', items: ['Smart warnings in "Do this next": logged twice, spending ahead of usual, price rises, forgotten subscriptions.'] },
  { v: '1.94.0', items: ['With the always-on bot on: a morning message (Safe to spend, what\'s due), an evening reminder when nothing was logged, Sunday\'s week and the 1st\'s recap.'] },
  { v: '1.93.0', items: ['Your server backs up Money every night and keeps 30 days: Settings → Data & backups → Server backups, with Restore.'] },
  { v: '1.92.0', items: ['Settings → Data & health: space left, how long it lasts, sync, devices and checks. A click on the version under the name opens it.'] },
  { v: '1.91.0', items: ['The version number is shown under the app\'s name.'] },
  { v: '1.90.0', items: ['Plan → Subscriptions: one table with type, amount, currency, how often, next payment, paid from and reminders.', 'Quick add shows the subcategory ("Type").'] },
  { v: '1.89.0', items: ['An always-on Telegram bot on your own server (Settings → Telegram & Binance → Turn on).'] },
  { v: '1.88.0', items: ['Forgot your PIN? Set a new one with the server\'s setup key.'] },
  { v: '1.87.0', items: ['Settings grouped into Spending and Saving.'] },
  { v: '1.86.0', items: ['A calmer Home: no red alarm when bills come first; the moving background is off.'] },
  { v: '1.85.0', items: ['Web and desktop stay in step, with a sync line under the name.', 'Add a record on an earlier day: Yesterday buttons, or "yesterday 120 lunch" in Quick add.'] },
];

/** The notes for versions newer than `from`, up to `to` (newest first). */
export function notesSince(from, to, notes = NOTES) {
  return notes.filter((n) => isNewerVersion(n.v, from) && !isNewerVersion(n.v, to));
}

/** Whether to show "What's new" now: after an update this device hasn't shown it for. */
export function shouldShow(meta = {}, current) {
  return !!meta.previousVersion && isNewerVersion(current, meta.previousVersion) && meta.whatsNewSeen !== current && notesSince(meta.previousVersion, current).length > 0;
}
