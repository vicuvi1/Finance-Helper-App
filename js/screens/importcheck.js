// Import check: right after importing your sheet, each tab's own totals next
// to what's in the app now, and the rows that explain any difference. The
// last check is kept on this device (Settings → Your data) to look at again.

import { ctx, esc } from '../ctx.js';
import { monthLabel } from '../dates.js';

const SOURCE = {
  stated: 'your sheet\'s totals',
  'total row': 'the total row',
  columns: 'the columns added up',
};

function tabRow(c) {
  const cell = (k) => {
    const d = c.diff[k];
    return `<td class="num"><span class="muted">${ctx.money(c.sheet[k])}</span><br><b>${ctx.money(c.app[k])}</b>${d ? `<span class="ic-diff">${d > 0 ? 'missing' : 'extra'} ${ctx.money(Math.abs(d))}</span>` : ''}</td>`;
  };
  const months = (c.months || []).map((m) => monthLabel(m, true)).join(', ');
  const why = c.ok ? '' : `<tr class="ic-why"><td colspan="4">
    ${c.skippedRows.length ? `<p>Not imported, no date in the row:</p><ul>${c.skippedRows.map((r) => `<li>Row ${r.row}${r.label ? ` "${esc(r.label)}"` : ''}: ${[r.earned ? `earned ${ctx.money(r.earned)}` : '', r.spent ? `spent ${ctx.money(r.spent)}` : ''].filter(Boolean).join(', ')}</li>`).join('')}</ul>` : ''}
    ${!c.skippedRows.length ? `<p>The sheet says ${ctx.money(c.sheet.earned)} earned / ${ctx.money(c.sheet.spent)} spent (${SOURCE[c.source.earned]}), but its rows add up to ${ctx.money(c.app.earned)} / ${ctx.money(c.app.spent)}. A total cell in the sheet may include something that isn't a row.</p>` : ''}
    <p class="muted">Fix it in the sheet and import again (records already here are skipped), or add the record here.</p>
  </td></tr>`;
  return `<tr class="${c.ok ? 'ic-ok' : 'ic-bad'}">
    <td><b>${esc(c.name || months || 'Import')}</b><br><span class="muted small">${[c.name && c.name !== (c.months || []).map((m) => monthLabel(m)).join(', ') ? months : '', c.added ? `${c.added} new` : '', c.duplicates ? `${c.duplicates} already here` : ''].filter(Boolean).join(' · ')}</span></td>
    ${cell('earned')}${cell('spent')}
    <td class="ic-st">${c.ok ? '<span class="pill pill-in">✓ Matches</span>' : '<span class="pill pill-out">Check</span>'}</td>
  </tr>${why}`;
}

export function open(checks = ctx.state.meta.lastImportCheck?.checks) {
  if (!checks?.length) { ctx.toast('No import to check yet. Import your sheet in Settings → Your data.'); return; }
  const bad = checks.filter((c) => !c.ok).length;
  const head = bad
    ? `<div class="ic-sum bad">⚠️ <span><b>${bad} of ${checks.length} tab${checks.length === 1 ? '' : 's'} ${bad === 1 ? 'doesn\'t' : 'don\'t'} match.</b> The rows below explain why.</span></div>`
    : `<div class="ic-sum ok">✅ <span><b>Everything matches your sheet.</b> ${checks.length} tab${checks.length === 1 ? '' : 's'}, earned and spent, to the last ban.</span></div>`;
  ctx.openSheet(`<h3>Import check <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    ${head}
    <div class="ic-wrap"><table class="ic-table">
      <thead><tr><th>Tab</th><th class="num">Earned<br><span>sheet / app</span></th><th class="num">Spent<br><span>sheet / app</span></th><th></th></tr></thead>
      <tbody>${checks.map(tabRow).join('')}</tbody>
    </table></div>
    <p class="muted small">"Sheet" is ${[...new Set(checks.flatMap((c) => Object.values(c.source)))].map((s) => SOURCE[s]).join(' or ')}; "app" is every record from that tab now in the app, new or imported before.</p>
    <div class="btns"><button class="btn primary" data-close>Done</button></div>`);
}

// Keep the check (this device only) and show it.
export function show(checks) {
  ctx.state.meta.lastImportCheck = { at: Date.now(), checks };
  ctx.persist();
  if (ctx.ui.tab === 'settings') ctx.render();
  open(checks);
}
