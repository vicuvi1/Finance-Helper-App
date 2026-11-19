// Settings -> Categories & rules -> "Budget warnings" (#8): the switch for
// Life System's notifications at 80% and 100% of a category's monthly budget
// (js/budgetwarn.js). settings.budgetWarn, missing = on; it syncs with the
// data like every plain setting.

import { ctx } from '../ctx.js';
import { warningsOn } from '../budgetwarn.js';

export function settingsCard() {
  const on = warningsOn(ctx.state);
  return `<section class="card"><h2>Budget warnings</h2>
    <p class="muted small" style="margin-top:0">When a category reaches 80% and then 100% of its monthly budget, the app sends one calm notification for each (a system notification on the desktop, a browser notification on the web), once a month. At most 4 notifications a day. With amounts hidden, the notification shows the percentage only.</p>
    <label class="motion-setting"><span><b>Budget warnings</b></span><input type="checkbox" data-bw="on" ${on ? 'checked' : ''} aria-label="Budget warnings" data-testid="budget-warn-toggle"></label></section>`;
}

let bound = false;
/** Installs the listener (once). */
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.dataset?.bw !== 'on' || ctx.state._sealed) return;
    ctx.state.settings.budgetWarn = !!el.checked;
    ctx.state.settings.updatedAt = Date.now();
    ctx.persistSync();
    ctx.toast(el.checked ? 'Budget warnings are on' : 'Budget warnings are off');
  });
}
