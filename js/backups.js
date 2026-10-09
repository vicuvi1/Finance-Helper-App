// Backup history rules (pure, tested): one file per day named
// finance-helper-YYYY-MM-DD.json; keep the last 30 days, and the first
// backup of each month for 24 months.

export const backupName = (iso) => `finance-helper-${iso}.json`;
export const dateOf = (name) => /(\d{4}-\d{2}-\d{2})/.exec(name)?.[1] || null;

// Names to delete from a list of backup file names.
export function toPrune(names, today, { days = 30, months = 24 } = {}) {
  const t = Date.parse(`${today}T00:00:00Z`);
  const dated = names.map((n) => ({ n, d: dateOf(n) })).filter((x) => x.d).sort((a, b) => a.d.localeCompare(b.d));
  const firstOfMonth = new Set();
  const seen = new Set();
  for (const x of dated) {
    const m = x.d.slice(0, 7);
    if (!seen.has(m)) { seen.add(m); firstOfMonth.add(x.n); }
  }
  return dated.filter((x) => {
    const age = (t - Date.parse(`${x.d}T00:00:00Z`)) / 864e5;
    if (age < days) return false;
    if (firstOfMonth.has(x.n) && age < months * 31) return false;
    return true;
  }).map((x) => x.n);
}
