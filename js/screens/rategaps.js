// The warning row in an import preview when rows in another currency have no
// rate to the main currency: "No EUR→MDL rate for 12 rows: they would count
// 1:1", with Fetch rates, Set one rate, or Skip these rows. The Import button
// stays off until every such row has a rate or is skipped, so nothing goes in
// silently as 1:1. Used by the CSV, workbook and bank statement imports.

import { ctx, esc } from '../ctx.js';
import { rateGaps } from '../importer.js';

export const gapsOf = (txs) => rateGaps(txs, ctx.state.settings.currency);

export function gapHTML(gaps) {
  if (!gaps.length) return '';
  const base = ctx.state.settings.currency;
  return gaps.map((g) => `<div class="rate-gap" data-testid="rate-gap" data-cur="${esc(g.currency)}" role="alert">
    <p><b>⚠️ No ${esc(g.currency)}→${esc(base)} rate for ${g.count} row${g.count === 1 ? '' : 's'}:</b> they would count 1:1 (1 ${esc(g.currency)} as 1 ${esc(base)}).</p>
    <div class="rate-gap-acts">
      <button type="button" class="btn small" data-gap="fetch" data-cur="${esc(g.currency)}">Fetch rates</button>
      <span class="rate-gap-set"><label>1 ${esc(g.currency)} = <input type="text" inputmode="decimal" data-gap-rate="${esc(g.currency)}" aria-label="Rate: 1 ${esc(g.currency)} in ${esc(base)}" size="7"> ${esc(base)}</label> <button type="button" class="btn small" data-gap="set" data-cur="${esc(g.currency)}">Set rate</button></span>
      <button type="button" class="btn small" data-gap="skip" data-cur="${esc(g.currency)}">Skip these rows</button>
    </div>
  </div>`).join('');
}

// A click inside the preview. `on` gets { kind: 'fetch' | 'set' | 'skip', currency, rate }.
// Returns true when the click was one of these buttons.
export function onGapClick(e, sheet, on) {
  const b = e.target.closest('[data-gap]');
  if (!b) return false;
  const currency = b.dataset.cur;
  if (b.dataset.gap === 'set') {
    const input = sheet.querySelector(`[data-gap-rate="${CSS.escape(currency)}"]`);
    const rate = Number(String(input?.value || '').replace(',', '.').trim());
    if (!(rate > 0)) { ctx.toast(`Type the rate: how many ${ctx.state.settings.currency} is 1 ${currency}`); input?.focus(); return true; }
    on({ kind: 'set', currency, rate });
  } else on({ kind: b.dataset.gap, currency });
  return true;
}

// "Fetch rates": downloads today's rates, then calls back (the rows take them).
export async function fetchRates() {
  await ctx.updateRates({ force: true, announce: true });
}
