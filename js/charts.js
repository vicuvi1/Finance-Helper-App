// Tiny inline-SVG charts. Colors come from CSS variables so both themes work.

import { monthLabel } from './dates.js';

// Income vs spending per month, side by side.
export function trendChart(rows, fmt) {
  const W = 340;
  const H = 170;
  const top = 10;
  const bottom = 24;
  const plotH = H - top - bottom;
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));
  const slot = W / rows.length;
  const bw = Math.min(16, slot * 0.28);
  const y = (v) => top + plotH - (v / max) * plotH;
  const bars = rows.map((r, i) => {
    const cx = slot * i + slot / 2;
    const label = monthLabel(r.key, true).slice(0, 3);
    const tip = `${monthLabel(r.key)}: earned ${fmt(r.income)}, spent ${fmt(r.expense)}`;
    const bar = (v, x, color) => {
      const h = Math.max(v > 0 ? 2 : 0, top + plotH - y(v));
      return `<rect x="${x.toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" style="fill:var(${color})"/>`;
    };
    return `<g><title>${tip}</title>${bar(r.income, cx - bw - 1, '--income')}${bar(r.expense, cx + 1, '--expense')}`
      + `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${label}</text></g>`;
  }).join('');
  const base = `<line x1="0" x2="${W}" y1="${top + plotH + 0.5}" y2="${top + plotH + 0.5}" style="stroke:var(--line)"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Earned and spent per month">${base}${bars}</svg>`;
}

// Spending per day this month: one bar per day, a dashed line at the daily
// average, days still ahead shown as faint stubs.
export function dailyChart(days, fmt) {
  const W = 620;
  const H = 168;
  const top = 18;
  const bottom = 22;
  const left = 4;
  const plotH = H - top - bottom;
  const past = days.filter((d) => !d.future);
  const max = Math.max(1, ...past.map((d) => d.amount));
  const avg = past.length ? past.reduce((a, d) => a + d.amount, 0) / past.length : 0;
  const slot = (W - left) / days.length;
  const bw = Math.max(3, slot * 0.62);
  const y = (v) => top + plotH - (v / max) * plotH;
  const bars = days.map((d, i) => {
    const x = left + slot * i + (slot - bw) / 2;
    if (d.future) return `<rect x="${x.toFixed(1)}" y="${top + plotH - 2}" width="${bw.toFixed(1)}" height="2" rx="1" style="fill:var(--line)"/>`;
    const h = d.amount ? Math.max(2, top + plotH - y(d.amount)) : 2;
    const color = d.amount ? (d.amount > avg * 1.5 ? 'var(--expense)' : 'var(--chart-bar)') : 'var(--line)';
    return `<g><title>${d.iso}: ${d.amount ? fmt(d.amount) : 'nothing spent'}</title><rect x="${x.toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" style="fill:${color}"/></g>`;
  }).join('');
  const labels = days.filter((d) => [1, 8, 15, 22, 29].includes(d.day))
    .map((d) => `<text x="${(left + slot * (d.day - 1) + slot / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${d.day}</text>`).join('');
  const avgY = y(avg).toFixed(1);
  const avgLine = avg ? `<line x1="${left}" x2="${W}" y1="${avgY}" y2="${avgY}" style="stroke:var(--muted);stroke-dasharray:3 4;opacity:.7"/>
    <text x="${W}" y="${(Number(avgY) - 5).toFixed(1)}" text-anchor="end">avg ${fmt(Math.round(avg))}</text>` : '';
  const base = `<line x1="0" x2="${W}" y1="${top + plotH + 0.5}" y2="${top + plotH + 0.5}" style="stroke:var(--line)"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending per day this month">${base}${bars}${avgLine}${labels}</svg>`;
}

// A value over time (e.g. savings at the end of each month): line with a soft
// area under it and the last point marked.
export function lineChart(points, fmt, { color = 'var(--gold)' } = {}) {
  const W = 620;
  const H = 150;
  const top = 16;
  const bottom = 22;
  const plotH = H - top - bottom;
  if (!points.length) return '';
  const vals = points.map((p) => p.value);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const step = points.length > 1 ? (W - 8) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [4 + i * step, top + plotH - ((p.value - min) / span) * plotH]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy.at(-1)[0].toFixed(1)} ${top + plotH} L${xy[0][0].toFixed(1)} ${top + plotH} Z`;
  const [lx, ly] = xy.at(-1);
  const labels = points.map((p, i) => (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1
    ? `<text x="${xy[i][0].toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${p.label}</text>` : '')).join('');
  const dots = points.map((p, i) => `<circle cx="${xy[i][0].toFixed(1)}" cy="${xy[i][1].toFixed(1)}" r="9" style="fill:transparent"><title>${p.label}: ${fmt(p.value)}</title></circle>`).join('');
  return `<svg class="chart line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings over time">
    <path d="${area}" style="fill:${color};opacity:.12"/>
    <path d="${line}" class="draw" pathLength="1" style="fill:none;stroke:${color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" style="fill:${color}"/>
    <text x="${Math.min(lx, W - 4).toFixed(1)}" y="${Math.max(12, ly - 10).toFixed(1)}" text-anchor="end" style="fill:var(--text);font-weight:600">${fmt(points.at(-1).value)}</text>
    ${labels}${dots}</svg>`;
}
