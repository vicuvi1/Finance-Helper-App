// "What's new": after the app updates, a short note says what changed, in
// plain words. Shown once per update (meta.whatsNewSeen, this device only),
// and any time from Settings → About & updates. Add a line here with every
// release that changes something you can see (newest first).

import { isNewerVersion } from './version.js';

export const NOTES = [
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
