// "What's new": after the app updates, a short note says what changed, in
// plain words. Shown once per update (meta.whatsNewSeen, this device only),
// and any time from Settings → About & updates. Add a line here with every
// release that changes something you can see (newest first).

import { isNewerVersion } from './version.js';

export const NOTES = [
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
