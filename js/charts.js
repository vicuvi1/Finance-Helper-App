// Tiny inline-SVG charts. Colors come from CSS variables so both themes work.

import { monthLabel } from './dates.js';
const escapeText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    <text x="${W}" y="${(Number(avgY) - 5).toFixed(1)}" text-anchor="end">avg ${fmt(Math.round(avg / 100) * 100)}</text>` : '';
  const base = `<line x1="0" x2="${W}" y1="${top + plotH + 0.5}" y2="${top + plotH + 0.5}" style="stroke:var(--line)"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending per day this month">${base}${bars}${avgLine}${labels}</svg>`;
}

// Smooth curve through the points that never overshoots them (monotone
// cubic, Fritsch–Carlson): one [start, control, control, end] per segment.
function monotone(xy) {
  const n = xy.length;
  const sl = xy.slice(1).map(([x, y], i) => (y - xy[i][1]) / (x - xy[i][0] || 1));
  const t = xy.map((_, i) => (i === 0 ? sl[0] : i === n - 1 ? sl[n - 2] : sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2));
  sl.forEach((m, i) => {
    if (m === 0) { t[i] = 0; t[i + 1] = 0; return; }
    const a = t[i] / m;
    const b = t[i + 1] / m;
    const h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m; t[i + 1] = k * b * m; }
  });
  return xy.slice(1).map(([x, y], i) => {
    const [x0, y0] = xy[i];
    const d = (x - x0) / 3;
    return [[x0, y0], [x0 + d, y0 + t[i] * d], [x - d, y - t[i + 1] * d], [x, y]];
  });
}
let lineId = 0;
const niceDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${Number(d.slice(8))} ${monthLabel(d.slice(0, 7), true)}` : d);

// A value over time (e.g. savings at the end of each month): a smooth line
// over a soft gradient, light gridlines, and a guide with the exact figure
// under the mouse (or keyboard focus). Estimated stretches are dashed.
export function lineChart(points, fmt, { color = 'var(--gold)', label = 'Savings over time' } = {}) {
  const W = 620;
  const H = 170;
  const top = 26;
  const bottom = 22;
  const plotH = H - top - bottom;
  if (!points.length) return '';
  const id = `lc${++lineId}`;
  const f = (n) => n.toFixed(1);
  const vals = points.map((p) => p.value);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const step = points.length > 1 ? (W - 8) / (points.length - 1) : W;
  const base = top + plotH;
  const xy = points.map((p, i) => [points.length === 1 ? W / 2 : 4 + i * step, base - ((p.value - min) / span) * plotH]);
  const segs = monotone(xy);
  const curve = (sg) => `C${f(sg[1][0])} ${f(sg[1][1])} ${f(sg[2][0])} ${f(sg[2][1])} ${f(sg[3][0])} ${f(sg[3][1])}`;
  const area = segs.length
    ? `M${f(xy[0][0])} ${f(xy[0][1])} ${segs.map(curve).join(' ')} L${f(xy.at(-1)[0])} ${base} L${f(xy[0][0])} ${base} Z`
    : '';
  const grid = [0, 0.5, 1].map((r) => `<line class="lc-grid" x1="0" x2="${W}" y1="${f(top + plotH * r)}" y2="${f(top + plotH * r)}"/>`).join('');
  const [lx, ly] = xy.at(-1);
  const every = Math.ceil(points.length / 6);
  const labels = points.map((p, i) => ((i % every === 0 && points.length - 1 - i >= every / 2) || i === points.length - 1
    ? `<text x="${f(xy[i][0])}" y="${H - 5}" text-anchor="${points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${escapeText(p.label)}</text>` : '')).join('');
  const segments = segs.map((sg, i) => `<path d="M${f(sg[0][0])} ${f(sg[0][1])} ${curve(sg)}" style="fill:none;stroke:${color};stroke-width:2.25;stroke-linecap:round;${points[i].snap === false || points[i + 1].snap === false ? 'stroke-dasharray:5 4;' : ''}"/>`).join('');
  const dots = points.map((p, i) => {
    const tip = escapeText(`${niceDate(p.date) || p.label}: ${fmt(p.value)}${p.snap === false ? ' · Estimated' : p.snap === true ? ' · Actual balance' : ''}`);
    const [x, y] = xy[i];
    const left = i < points.length / 2;
    const tx = Math.min(W - 4, Math.max(4, left ? x + 10 : x - 10));
    return `<g class="chart-point" tabindex="0" aria-label="${tip}"><rect x="${f(Math.max(0, x - step / 2))}" y="0" width="${f(Math.min(step, W))}" height="${base}" fill="transparent"><title>${tip}</title></rect><line class="point-guide" x1="${f(x)}" x2="${f(x)}" y1="${top - 6}" y2="${base}"/><circle class="point-mark" cx="${f(x)}" cy="${f(y)}" r="5" style="fill:${color}"/><text class="point-tip" x="${f(tx)}" y="${top - 10}" text-anchor="${left ? 'start' : 'end'}">${tip}</text></g>`;
  }).join('');
  return `<svg class="chart line-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${escapeText(label)}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.3"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs>
    ${grid}
    ${area ? `<path d="${area}" fill="url(#${id})"/>` : ''}
    ${segments}
    <circle cx="${f(lx)}" cy="${f(ly)}" r="9" class="lc-halo" style="fill:${color}"/>
    <circle cx="${f(lx)}" cy="${f(ly)}" r="4.5" style="fill:${color}"/>
    <text class="lc-last" x="${f(Math.min(lx, W - 4))}" y="${f(Math.max(14, ly - 14))}" text-anchor="${points.length === 1 ? 'middle' : 'end'}">${escapeText(fmt(points.at(-1).value))}</text>
    ${labels}${dots}</svg>`;
}

// Interactive Cash Flow Sankey Diagram.
// Visualizes money entering from income sources, splitting across smart jars
// (70/10/10/10 or custom), and branching out into expense categories and net savings.
export function sankeyChart(data, fmt, { mode = 'jars', width = 760, height = 360 } = {}) {
  const { income = 0, expense = 0, sources = [], jars = [], categories = [] } = data || {};
  const totalInflow = Math.max(income, expense);
  if (!totalInflow || totalInflow <= 0) {
    return `<div class="chart-empty muted" style="padding:48px 16px;text-align:center;">No cash flow recorded for this period yet.</div>`;
  }

  const W = width || 760;
  const H = height || 360;
  const padTop = 32;
  const padBottom = 26;
  const plotH = H - padTop - padBottom;
  const nodeW = 12;
  const minH = 10;
  const gap = 12;

  // 1. Prepare Columns and Nodes
  // Col 0: Inflows
  const srcNodes = [];
  const deficit = Math.max(0, expense - income);
  if (sources.length) {
    for (const s of sources) {
      if (s.amount > 0) {
        srcNodes.push({
          id: s.id,
          name: s.name,
          amount: s.amount,
          type: 'source',
          color: s.color || 'var(--income)',
        });
      }
    }
  }
  if (deficit > 0) {
    srcNodes.push({
      id: '_reserves',
      name: 'Reserves / Deficit',
      amount: deficit,
      type: 'source',
      color: 'var(--warn)',
    });
  }
  if (!srcNodes.length) {
    srcNodes.push({
      id: '_reserves',
      name: 'Reserves / Cash',
      amount: totalInflow,
      type: 'source',
      color: 'var(--chart-bar)',
    });
  }

  // Outflows (Expenses + Kept)
  const outNodes = [];
  const sortedCats = [...categories].filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const topCats = sortedCats.slice(0, 6);
  const restCats = sortedCats.slice(6);
  for (const c of topCats) {
    outNodes.push({
      id: c.id,
      name: c.name,
      amount: c.amount,
      jarId: c.jarId,
      type: 'category',
      color: c.color || 'var(--expense)',
    });
  }
  if (restCats.length) {
    const restAmt = restCats.reduce((sum, c) => sum + c.amount, 0);
    outNodes.push({
      id: '_other_expenses',
      name: `Other (${restCats.length})`,
      amount: restAmt,
      type: 'category',
      color: 'var(--chart-bar)',
    });
  }
  const netKept = Math.max(0, income - expense);
  if (netKept > 0) {
    outNodes.push({
      id: '_kept',
      name: 'Kept in Safe',
      amount: netKept,
      type: 'kept',
      color: 'var(--gold)',
    });
  }

  function layoutCol(nodes, x) {
    const n = nodes.length;
    if (!n) return;
    const totalVal = nodes.reduce((a, b) => a + b.amount, 0) || 1;
    const totalGap = (n - 1) * gap;
    const availH = Math.max(n * minH, plotH - totalGap);
    const colH = availH + totalGap;
    let currY = padTop + (colH < plotH ? (plotH - colH) / 2 : 0);

    for (const node of nodes) {
      const rawH = (node.amount / totalVal) * availH;
      node.h = Math.max(minH, rawH);
      node.x = x;
      node.y = currY;
      node.outY = currY;
      node.inY = currY;
      currY += node.h + gap;
    }
  }

  const gradients = [];
  const links = [];

  function addLink(source, target, amount) {
    if (!source || !target || amount <= 0) return;
    const linkId = `sankey-g-${links.length}`;
    gradients.push({
      id: linkId,
      fromColor: source.color || 'var(--income)',
      toColor: target.color || 'var(--expense)',
    });
    links.push({ source, target, amount, gradId: linkId });
  }

  let jarNodes = null;
  const colX = mode === 'jars' && jars.length
    ? [120, Math.round(W / 2 - nodeW / 2), W - 140]
    : [140, W - 150];

  if (mode === 'jars' && jars.length) {
    jarNodes = jars.map((j, i) => {
      const amt = Math.max(1, Math.round(totalInflow * (j.pct / 100)));
      return {
        id: j.id,
        name: j.name,
        emoji: j.emoji || '🫙',
        pct: j.pct,
        amount: amt,
        savings: j.savings,
        type: 'jar',
        color: j.savings ? 'var(--gold)' : (j.color || `var(--c${(i % 8) + 1})`),
      };
    });

    const jarSum = jarNodes.reduce((a, b) => a + b.amount, 0);
    const diff = totalInflow - jarSum;
    if (diff !== 0 && jarNodes.length) {
      jarNodes[0].amount += diff;
    }

    layoutCol(srcNodes, colX[0]);
    layoutCol(jarNodes, colX[1]);
    layoutCol(outNodes, colX[2]);

    // Connect Sources -> Jars
    for (const s of srcNodes) {
      for (const j of jarNodes) {
        const flow = Math.round(s.amount * (j.amount / totalInflow));
        if (flow > 0) addLink(s, j, flow);
      }
    }

    // Connect Jars -> Outflows
    const catsByJar = new Map();
    for (const out of outNodes) {
      if (out.type === 'category' && out.jarId) {
        const list = catsByJar.get(out.jarId) || [];
        list.push(out);
        catsByJar.set(out.jarId, list);
      }
    }
    const keptNode = outNodes.find((n) => n.id === '_kept');

    for (const j of jarNodes) {
      const jarCats = catsByJar.get(j.id) || [];
      const spentInJar = jarCats.reduce((a, b) => a + b.amount, 0);
      for (const c of jarCats) {
        addLink(j, c, c.amount);
      }
      if (j.savings) {
        if (keptNode) addLink(j, keptNode, j.amount);
      } else {
        const unspent = Math.max(0, j.amount - spentInJar);
        if (unspent > 0 && keptNode) {
          addLink(j, keptNode, unspent);
        }
      }
    }

    // Any remaining categories not assigned to a jar
    for (const out of outNodes) {
      if (out.inY === out.y && out.id !== '_kept') {
        const targetJar = jarNodes.find((j) => !j.savings) || jarNodes[0];
        if (targetJar) addLink(targetJar, out, out.amount);
      }
    }
  } else {
    layoutCol(srcNodes, colX[0]);
    layoutCol(outNodes, colX[1]);

    for (const s of srcNodes) {
      for (const o of outNodes) {
        const flow = Math.round(s.amount * (o.amount / totalInflow));
        if (flow > 0) addLink(s, o, flow);
      }
    }
  }

  // Generate ribbon paths
  const ribbonPaths = links.map(({ source, target, amount, gradId }) => {
    const srcThick = Math.max(1, (amount / source.amount) * source.h);
    const tgtThick = Math.max(1, (amount / target.amount) * target.h);

    const y0 = source.outY;
    const y1 = Math.min(source.y + source.h, y0 + srcThick);
    source.outY = y1;

    const y2 = target.inY;
    const y3 = Math.min(target.y + target.h, y2 + tgtThick);
    target.inY = y3;

    const x0 = source.x + nodeW;
    const x1 = target.x;
    const cx = (x0 + x1) / 2;

    const d = `M ${x0.toFixed(1)} ${y0.toFixed(1)} `
      + `C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y2.toFixed(1)}, ${x1.toFixed(1)} ${y2.toFixed(1)} `
      + `L ${x1.toFixed(1)} ${y3.toFixed(1)} `
      + `C ${cx.toFixed(1)} ${y3.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x0.toFixed(1)} ${y1.toFixed(1)} Z`;

    const tip = `${escapeText(source.name)} → ${escapeText(target.name)}: ${escapeText(fmt(amount))}`;
    return `<path class="sankey-ribbon" data-source-id="${escapeText(source.id)}" data-target-id="${escapeText(target.id)}" d="${d}" fill="url(#${gradId})"><title>${tip}</title></path>`;
  }).join('');

  // Node rects & labels
  const leftSvg = srcNodes.map((n) => {
    const tip = `${escapeText(n.name)}: ${escapeText(fmt(n.amount))}`;
    return `<g class="sankey-node" data-node-id="${escapeText(n.id)}" data-act="rep-cat" data-cat="${escapeText(n.id)}" data-type="income" tabindex="0">
      <title>${tip}</title>
      <rect x="${n.x.toFixed(1)}" y="${n.y.toFixed(1)}" width="${nodeW}" height="${n.h.toFixed(1)}" rx="3" fill="${n.color}"/>
      <text x="${(n.x - 8).toFixed(1)}" y="${(n.y + n.h / 2).toFixed(1)}" text-anchor="end" class="sankey-label">
        <tspan class="sankey-name" x="${(n.x - 8).toFixed(1)}" dy="-2">${escapeText(n.name)}</tspan>
        <tspan class="sankey-val" x="${(n.x - 8).toFixed(1)}" dy="12">${escapeText(fmt(n.amount))}</tspan>
      </text>
    </g>`;
  }).join('');

  const centerSvg = (jarNodes ? jarNodes.map((n) => {
    const tip = `${escapeText(n.name)} (${n.pct}%): ${escapeText(fmt(n.amount))}`;
    return `<g class="sankey-node" data-node-id="${escapeText(n.id)}" tabindex="0">
      <title>${tip}</title>
      <rect x="${n.x.toFixed(1)}" y="${n.y.toFixed(1)}" width="${nodeW}" height="${n.h.toFixed(1)}" rx="3" fill="${n.color}"/>
      <text x="${(n.x + nodeW / 2).toFixed(1)}" y="${(n.y + n.h / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" class="sankey-center-label">
        <tspan class="sankey-name">${escapeText(n.emoji)} ${escapeText(n.name)}</tspan>
        <tspan class="sankey-val" x="${(n.x + nodeW / 2).toFixed(1)}" dy="12">${escapeText(fmt(n.amount))} (${n.pct}%)</tspan>
      </text>
    </g>`;
  }).join('') : '');

  const rightSvg = outNodes.map((n) => {
    const tip = `${escapeText(n.name)}: ${escapeText(fmt(n.amount))}`;
    const act = n.type === 'category' ? `data-act="rep-cat" data-cat="${escapeText(n.id)}" data-type="expense"` : '';
    return `<g class="sankey-node" data-node-id="${escapeText(n.id)}" ${act} tabindex="0">
      <title>${tip}</title>
      <rect x="${n.x.toFixed(1)}" y="${n.y.toFixed(1)}" width="${nodeW}" height="${n.h.toFixed(1)}" rx="3" fill="${n.color}"/>
      <text x="${(n.x + nodeW + 8).toFixed(1)}" y="${(n.y + n.h / 2).toFixed(1)}" text-anchor="start" class="sankey-label">
        <tspan class="sankey-name" x="${(n.x + nodeW + 8).toFixed(1)}" dy="-2">${escapeText(n.name)}</tspan>
        <tspan class="sankey-val" x="${(n.x + nodeW + 8).toFixed(1)}" dy="12">${escapeText(fmt(n.amount))}</tspan>
      </text>
    </g>`;
  }).join('');

  const headers = jarNodes ? `
    <text x="${(colX[0] + nodeW / 2).toFixed(1)}" y="16" text-anchor="middle" class="sankey-col-hdr">INCOME SOURCES</text>
    <text x="${(colX[1] + nodeW / 2).toFixed(1)}" y="16" text-anchor="middle" class="sankey-col-hdr">SMART JARS</text>
    <text x="${(colX[2] + nodeW / 2).toFixed(1)}" y="16" text-anchor="middle" class="sankey-col-hdr">SPENDING &amp; SAVINGS</text>
  ` : `
    <text x="${(colX[0] + nodeW / 2).toFixed(1)}" y="16" text-anchor="middle" class="sankey-col-hdr">INFLOWS</text>
    <text x="${(colX[1] + nodeW / 2).toFixed(1)}" y="16" text-anchor="middle" class="sankey-col-hdr">OUTFLOWS &amp; SAVINGS</text>
  `;

  const gradDefs = gradients.map((g) => `
    <linearGradient id="${g.id}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${g.fromColor}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${g.toColor}" stop-opacity="0.45"/>
    </linearGradient>
  `).join('');

  return `<svg class="chart sankey-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash flow flowchart">
    <defs>${gradDefs}</defs>
    ${headers}
    <g class="sankey-ribbons">${ribbonPaths}</g>
    <g class="sankey-nodes">${leftSvg}${centerSvg}${rightSvg}</g>
  </svg>`;
}

// Hovering a node highlights its ribbons and connected nodes; hovering a ribbon highlights it.
export function bindSankeyHover(root) {
  if (!root) return;
  root.addEventListener('mouseover', (e) => {
    const node = e.target.closest('.sankey-node');
    const ribbon = e.target.closest('.sankey-ribbon');
    const chart = (node || ribbon)?.closest('.sankey-chart');
    if (!chart) return;
    if (node) {
      const id = node.dataset.nodeId;
      for (const r of chart.querySelectorAll('.sankey-ribbon')) {
        const match = r.dataset.sourceId === id || r.dataset.targetId === id;
        r.classList.toggle('highlight', match);
        r.classList.toggle('dimmed', !match);
      }
      for (const n of chart.querySelectorAll('.sankey-node')) {
        n.classList.toggle('highlight', n.dataset.nodeId === id);
      }
    } else if (ribbon) {
      for (const r of chart.querySelectorAll('.sankey-ribbon')) {
        r.classList.toggle('highlight', r === ribbon);
        r.classList.toggle('dimmed', r !== ribbon);
      }
    }
  });

  root.addEventListener('mouseout', (e) => {
    const chart = e.target.closest('.sankey-chart');
    if (!chart) return;
    const related = e.relatedTarget?.closest('.sankey-chart');
    if (related !== chart) {
      for (const r of chart.querySelectorAll('.sankey-ribbon')) {
        r.classList.remove('highlight', 'dimmed');
      }
      for (const n of chart.querySelectorAll('.sankey-node')) {
        n.classList.remove('highlight');
      }
    }
  });
}

