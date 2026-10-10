// Settings → Your hour: what an hour of your work is worth, so expenses can
// be shown as work time ("3.5 h of your work").

import { ctx, esc } from '../ctx.js';
import { evalAmount, centsToPlain } from '../money.js';
import { todayISO } from '../dates.js';
import { hourlyRate, workPrefs, formatWork, DEFAULT_HOURS } from '../workhours.js';

const SOURCE = {
  manual: 'set by you',
  invoices: 'from your paid invoices with hours',
  income: 'from your income of the last 3 months',
};

export function settingsCard() {
  const { state } = ctx;
  const p = workPrefs(state);
  const r = hourlyRate(state, todayISO());
  const eg = r ? [10000, 50000, 300000].map((c) => `${ctx.money(c)} = ${formatWork(c / r.rate)}`).join(' · ') : '';
  return `<section class="card" id="wh-card"><h2>Your hour</h2>
    <p class="muted small" style="margin-top:0">Expenses are also shown as the work they cost you: "≈ 3,5 h of your work". It makes a 1 500 lei jacket feel different.</p>
    ${r ? `<div class="wh-rate"><b>${ctx.money(r.rate)}</b><span>per hour, ${SOURCE[r.source]}</span></div><p class="muted small">${esc(eg)}</p>` : '<p class="muted small">Not enough income yet to work it out. Set it below.</p>'}
    <div class="row2">
      <label class="field"><span>Your hour</span><select data-wh="mode">
        <option value="auto" ${p.mode === 'auto' ? 'selected' : ''}>Work it out for me</option>
        <option value="manual" ${p.mode === 'manual' ? 'selected' : ''}>I'll set it</option>
      </select></label>
      ${p.mode === 'manual'
    ? `<label class="field"><span>Per hour (${esc(state.settings.currency)})</span><input type="text" inputmode="decimal" data-wh="rate" value="${p.rate ? centsToPlain(p.rate) : ''}" placeholder="150"></label>`
    : `<label class="field"><span>Hours you work a month</span><input type="number" min="1" max="400" data-wh="hoursPerMonth" value="${p.hoursPerMonth || DEFAULT_HOURS}"></label>`}
    </div>
    <label class="field check"><input type="checkbox" data-wh="show" ${p.show ? 'checked' : ''}><span>Show expenses as work time</span></label>
  </section>`;
}

export function onChange(el) {
  const k = el.dataset.wh;
  if (!k) return false;
  const { state } = ctx;
  const p = workPrefs(state);
  if (k === 'mode') p.mode = el.value;
  else if (k === 'show') p.show = el.checked;
  else if (k === 'rate') {
    const v = evalAmount(el.value);
    if (!v || v <= 0) { ctx.toast('Type what an hour of your work earns, e.g. 150'); return true; }
    p.rate = v;
  } else if (k === 'hoursPerMonth') {
    const v = Math.round(Number(el.value));
    if (!(v >= 1 && v <= 400)) { ctx.toast('Between 1 and 400 hours'); return true; }
    p.hoursPerMonth = v;
  }
  state.settings.workHour = p;
  state.settings.updatedAt = Date.now();
  ctx.persist();
  const card = document.getElementById('wh-card');
  if (card) card.outerHTML = settingsCard();
  return true;
}
