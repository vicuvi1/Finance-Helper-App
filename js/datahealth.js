// Data & health (Settings → Data & health): how big your data is, how much room
// is left on the server and on this device, and how long it lasts at your pace.
// Pure and tested (tests/datahealth.test.js); js/screens/datahealth.js draws it.

import { addMonths, monthKey } from './dates.js';

/** The server's room: Turso's free plan holds 5 GB (an assumption the page says out loud). */
export const SERVER_LIMIT = 5 * 1024 ** 3;

export function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** What is in your data: counts per kind, the first and last record day. */
export function dataCounts(state) {
  const tx = state.tx || [];
  const days = tx.map((t) => t.date).filter(Boolean).sort();
  return {
    records: tx.length,
    repeating: (state.recurring || []).length,
    people: (state.people || []).length,
    goals: (state.goals || []).length,
    invoices: (state.invoices || []).length,
    accounts: (state.settings?.accounts || []).filter((a) => !a.archived).length,
    categories: (state.settings?.categories || []).filter((c) => !c.archived).length,
    deleted: Object.keys(state.deleted || {}).length,
    first: days[0] || null,
    last: days[days.length - 1] || null,
  };
}

/** Records a month at your pace: the last 3 full months (or fewer when the data is new). */
export function recordsPerMonth(state, today) {
  const cur = monthKey(today);
  const months = [1, 2, 3].map((n) => addMonths(cur, -n));
  const counts = months.map((m) => (state.tx || []).filter((t) => t.date && t.date.startsWith(m)).length);
  const used = counts.filter((c, i) => c > 0 || i === 0);
  const avg = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
  return Math.max(avg, (state.tx || []).filter((t) => t.date?.startsWith(cur)).length);
}

/**
 * How long the room lasts. `used` and `limit` in bytes; `bytes` is your data's size now.
 * Returns {perMonth (bytes), years (null = more than 100), pct}.
 */
export function roomLeft({ used, limit, bytes, records, perMonthRecords }) {
  const perRecord = records > 0 ? bytes / records : 400;
  // Each sync keeps one copy; deletion markers and edits add a little: count 20% extra.
  const perMonth = Math.round(perRecord * perMonthRecords * 1.2);
  const free = Math.max(0, limit - used);
  const years = perMonth > 0 ? free / perMonth / 12 : null;
  return { perMonth, years: years == null || years > 100 ? null : years, pct: limit > 0 ? Math.min(100, (used / limit) * 100) : 0, free };
}

export const yearsText = (y) => (y == null ? 'more than 100 years' : y >= 10 ? `about ${Math.round(y)} years` : y >= 1 ? `about ${y.toFixed(1)} years` : `about ${Math.max(1, Math.round(y * 12))} months`);

/** A plain line for a device from its browser/app label. */
export function deviceName(label = '') {
  const l = String(label);
  const app = /Electron|FinanceHelper|finance-helper/i.test(l) ? 'Desktop app' : /Mobile|Android|iPhone/i.test(l) ? 'Phone browser' : 'Browser';
  const os = /Windows/i.test(l) ? 'Windows' : /Mac OS|Macintosh/i.test(l) ? 'Mac' : /Android/i.test(l) ? 'Android' : /iPhone|iPad|iOS/i.test(l) ? 'iPhone' : /Linux/i.test(l) ? 'Linux' : '';
  return os ? `${app} · ${os}` : app;
}

/**
 * The checks at the top: [{id, level: 'ok'|'warn'|'bad', title, text}].
 * Inputs are what the page already knows; anything unknown is left out.
 */
export function healthChecks({ sync, server, device, bot, update, lastBackup, lock, now = Date.now() }) {
  const out = [];
  if (sync) {
    if (!sync.signedIn) out.push({ id: 'sync', level: 'bad', title: 'Not syncing', text: 'This device keeps its own copy. Sign in (the line under the app\'s name) so web and desktop share one.' });
    else if (sync.error) out.push({ id: 'sync', level: 'bad', title: 'Sync problem', text: sync.error });
    else if (sync.dirty) out.push({ id: 'sync', level: 'warn', title: 'Changes waiting to be sent', text: 'They go as soon as the server answers.' });
    else out.push({ id: 'sync', level: sync.okAt && now - sync.okAt < 3600_000 ? 'ok' : 'warn', title: 'In sync', text: sync.okAt ? `Last synced ${ago(now - sync.okAt)}.` : 'Not synced yet.' });
  }
  if (server) {
    const lvl = server.pct >= 90 ? 'bad' : server.pct >= 70 ? 'warn' : 'ok';
    out.push({ id: 'server', level: lvl, title: 'Server space', text: `${formatBytes(server.used)} used of ${formatBytes(server.limit)}. At your pace it lasts ${yearsText(server.years)}.` });
  }
  if (device) {
    const lvl = device.pct >= 90 ? 'bad' : device.pct >= 70 ? 'warn' : 'ok';
    out.push({ id: 'device', level: lvl, title: 'This device\'s space', text: `${formatBytes(device.used)} used of ${formatBytes(device.limit)} the browser allows. At your pace it lasts ${yearsText(device.years)}.` });
  }
  if (bot) out.push({ id: 'bot', level: bot.on ? (bot.lastError ? 'warn' : 'ok') : 'warn', title: bot.on ? 'Telegram bot on' : 'Telegram bot off', text: bot.on ? (bot.lastError ? `Last problem: ${bot.lastError}` : `@${bot.bot} answers day and night.`) : (bot.why || 'Turn it on in Settings → Telegram & Binance.') });
  if (lock) out.push(lock.on && lock.minutes > 0 ? { id: 'lock', level: 'ok', title: 'Auto-lock on', text: `This device asks for its PIN after ${lock.minutes} minute${lock.minutes === 1 ? '' : 's'} away.` } : lock.on ? { id: 'lock', level: 'warn', title: 'Locks only at start', text: 'Choose "Lock after N minutes away" in Settings → Security.' } : { id: 'lock', level: 'warn', title: 'No auto-lock on this device', text: 'Set a PIN in Settings → Security: the app then locks itself when you step away.' })
  if (update) out.push({ id: 'update', level: update.waiting ? 'warn' : 'ok', title: update.waiting ? 'A new version is ready' : `Up to date (v${update.version})`, text: update.waiting ? 'Restart or reload to use it.' : 'Updates come by themselves.' });
  if (lastBackup !== undefined) out.push({ id: 'backup', level: lastBackup && now - lastBackup < 8 * 86400_000 ? 'ok' : 'warn', title: 'Backups', text: lastBackup ? `Last backup ${ago(now - lastBackup)}.` : 'No backup yet. Your server makes one every night once you are signed in (Settings → Data & backups).' });
  return out;
}

export function ago(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
