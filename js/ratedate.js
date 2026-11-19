// How old the exchange rates in use are (pure, no clock: `today` is passed in).
// The rate's own date is the newest date a source gave (open.er-api.com, or the
// National Bank of Moldova); with none, the day the rates were downloaded.
// Nothing here changes a stored record.

export const STALE_DAYS = 3; // a rate older than this gets a quiet warning

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 864e5);
const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The date (YYYY-MM-DD) of the newest rate in `rates`, or null when there is none.
export function rateDate(rates) {
  if (!rates?.usd || !Object.keys(rates.usd).length) return null;
  const dates = [rates.sources?.fiat?.date, rates.sources?.mdl?.date].filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length) return dates.sort().at(-1);
  return rates.fetchedAt ? localDay(rates.fetchedAt) : null;
}

// { date, days, stale, none } for the rates on `today` (YYYY-MM-DD).
export function rateStatus(rates, today, staleDays = STALE_DAYS) {
  const date = rateDate(rates);
  if (!date) return { date: null, days: null, stale: false, none: true };
  const days = Math.max(0, dayNumber(today) - dayNumber(date));
  return { date, days, stale: days > staleDays, none: false };
}

// "rate from 12 Nov"
export function rateFromText(date) {
  if (!date) return '';
  return `rate from ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}
