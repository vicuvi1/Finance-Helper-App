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
