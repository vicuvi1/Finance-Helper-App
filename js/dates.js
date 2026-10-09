// Dates are plain "YYYY-MM-DD" strings and months are "YYYY-MM", so there are
// no time zone surprises. Date objects are only built in UTC for weekday math.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Month names the importer understands: English, Romanian (with and without
// diacritics) and Russian, full or short.
const MONTH_NAMES = [
  ['january', 'jan', 'ianuarie', 'ian', 'январь', 'января', 'янв'],
  ['february', 'feb', 'februarie', 'febr', 'февраль', 'февраля', 'фев'],
  ['march', 'mar', 'martie', 'март', 'марта'],
  ['april', 'apr', 'aprilie', 'апрель', 'апреля', 'апр'],
  ['may', 'mai', 'май', 'мая'],
  ['june', 'jun', 'iunie', 'iun', 'июнь', 'июня'],
  ['july', 'jul', 'iulie', 'iul', 'июль', 'июля'],
  ['august', 'aug', 'august', 'август', 'августа', 'авг'],
  ['september', 'sep', 'sept', 'septembrie', 'сентябрь', 'сентября', 'сен'],
  ['october', 'oct', 'octombrie', 'октябрь', 'октября', 'окт'],
  ['november', 'nov', 'noiembrie', 'ноябрь', 'ноября', 'ноя'],
  ['december', 'dec', 'decembrie', 'декабрь', 'декабря', 'дек'],
];

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export const monthKey = (iso) => iso.slice(0, 7);

export function monthLabel(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  const name = MONTHS[m - 1];
  return `${short ? name.slice(0, 3) : name} ${y}`;
}

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthsBetween(fromKey, toKey) {
  const [a, b] = [fromKey, toKey].map((k) => k.split('-').map(Number));
  return (b[0] - a[0]) * 12 + (b[1] - a[1]);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function utc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function weekday(iso) {
  return utc(iso).getUTCDay();
}

// "Sun, 1 Mar"
export function dayLabel(iso) {
  const d = utc(iso);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

export function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = utc(iso);
  return toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) === iso;
}

function monthFromName(word) {
  const w = word.toLowerCase().replace(/\.$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (MONTH_NAMES[i].includes(w)) return i + 1;
  }
  return null;
}

// Reads the dates people actually type in sheets: "1 martie 2026", "March 1, 2026",
// "01.03.2026", "2026-03-01", "1/3/2026" (day first). Returns ISO or null.
export function parseLooseDate(text) {
  if (text == null) return null;
  const s = String(text).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let y, m, d;
  let r;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    [y, m, d] = [r[1], r[2], r[3]].map(Number);
  } else if ((r = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) {
    [d, m, y] = [r[1], r[2], r[3]].map(Number);
  } else if ((r = s.match(/^(\d{1,2})\.?\s+([^\d\s,]+),?\s+(\d{4})$/u))) {
    d = Number(r[1]); m = monthFromName(r[2]); y = Number(r[3]);
  } else if ((r = s.match(/^([^\d\s,]+)\s+(\d{1,2}),?\s+(\d{4})$/u))) {
    m = monthFromName(r[1]); d = Number(r[2]); y = Number(r[3]);
  } else {
    return null;
  }
  if (!m) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isValidISO(iso) ? iso : null;
}
