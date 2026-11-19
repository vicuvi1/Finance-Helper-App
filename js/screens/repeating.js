// Repeating records (Plan → Repeating, "To confirm" on Home). The rules live in
// state.recurring (js/recurring.js); this file shows them: what is due and
// waiting for you, every rule in one list, the custom "every N days / weeks /
// months / years" fields of the rule form, and the Undo for rules that add
// themselves. Logging, editing and skipping reuse Plan's own actions
// (rec-log, rec-log-edit, rec-skip, rec-edit).

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as R from '../recurring.js';
import { todayISO, dayLabel, daysBetween, addDays } from '../dates.js';
import { formatMoney } from '../money.js';

const catOf = (id) => M.category(ctx.state, id) || { name: 'Other' };
const titleOf = (r) => r.note || catOf(r.category).name;
const ruleMoney = (r) => (r.type === 'income' ? formatMoney(r.amount, r.currency, { sign: true }) : formatMoney(-r.amount, r.currency));
const when = (date, today) => {
  const d = daysBetween(today, date);
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : `in ${d} days`;
};

// ---------- To confirm (Home) ----------

/** Everything due up to today that is waiting for you. */
export const pending = (state = ctx.state, today = todayISO()) => R.dueItems(state, today);

export function toConfirmCard() {
  const today = todayISO();
  const due = pending(ctx.state, today);
  if (!due.length) return '';
  const rows = due.slice(0, 5).map(({ rule: r, date }) => `<div class="tx rec-row" data-testid="to-confirm-row" data-rule="${esc(r.id)}" data-date="${date}">
    <span class="t"><b>${esc(titleOf(r))}</b><span>${esc(dayLabel(date))} · ${when(date, today)} · ${esc(R.describe(r).toLowerCase())}</span></span>
    <span class="amount ${r.type === 'income' ? 'income' : ''}">${ruleMoney(r)}</span>
    <span class="rec-btns"><button class="btn primary sm" data-act="rec-log" data-id="${esc(r.id)}" data-date="${date}" data-testid="to-confirm-ok">${r.type === 'income' ? 'Got it' : 'Confirm'}</button><button class="btn sm" data-act="rec-log-edit" data-id="${esc(r.id)}" data-date="${date}">Edit</button><button class="btn sm" data-act="rec-skip" data-id="${esc(r.id)}" data-date="${date}">Skip</button></span>
  </div>`).join('');
  return `<section class="card" data-testid="to-confirm"><h2>To confirm <button class="card-link right" data-act="plan-open-repeating">Repeating</button></h2>
    <div class="list">${rows}</div>
    ${due.length > 5 ? `<p class="muted small" style="margin-bottom:0">${due.length - 5} more in Plan → Repeating.</p>` : ''}</section>`;
}

// ---------- Plan → Repeating ----------

export function tab() {
  const { state } = ctx;
  const today = todayISO();
  const all = (state.recurring || []).filter((r) => r.every !== 'once' || !r.lastDone);
  if (!all.length) {
    return `<section class="card" data-testid="repeating-tab"><h2>Repeating</h2><p class="muted" style="margin-top:0">Rent, subscriptions, salary: add it once and it comes back by itself. You confirm each one, or let it add itself.</p>
      <button class="btn primary" data-act="rec-new">+ Add repeating</button></section>`;
  }
  const due = new Set(pending(state, today).map((x) => x.rule.id));
  const sorted = [...all].sort((a, b) => Number(!!a.paused) - Number(!!b.paused) || a.type.localeCompare(b.type) || b.amount - a.amount);
  const row = (r) => {
    const next = R.nextDate(r, r.lastDone && r.lastDone >= today ? r.lastDone : addDays(today, -1));
    const label = r.paused ? 'paused' : due.has(r.id) ? 'waiting for you' : next ? `next ${dayLabel(next)}` : 'ended';
    const ends = r.end ? ` · until ${dayLabel(r.end)}` : '';
    return `<button class="tx" data-act="rec-edit" data-id="${esc(r.id)}" data-testid="repeating-row">
      <span class="t"><b>${esc(titleOf(r))} <span class="pill ${r.auto ? 'pill-gold' : ''}">${r.auto ? 'adds itself' : 'asks me'}</span></b><span>${esc(R.describe(r))}${esc(ends)} · ${esc(label)}</span></span>
      <span class="amount ${r.type === 'income' ? 'income' : ''} ${r.paused ? 'muted' : ''}">${ruleMoney(r)}</span></button>`;
  };
  return `<section class="card" data-testid="repeating-tab"><h2>Repeating <button class="btn primary sm right" data-act="rec-new">+ Add repeating</button></h2>
    <p class="muted small" style="margin-top:0">Every rule in one place. Each date is added once, even if two devices are open.</p>
    <div class="list">${sorted.map(row).join('')}</div></section>`;
}

// ---------- The custom fields of the rule form ----------

/** "Every [N] [days|weeks|months|years]" and, for months and years, a day of the month. */
export function customFields(r) {
  if (r.every !== 'custom') return '';
  const s = R.spec(r);
  return `<div class="row2" data-testid="rec-custom"><label class="field"><span>Every</span><input id="rec-n" type="number" min="1" max="999" inputmode="numeric" value="${s.n}" aria-label="Repeat every"></label>
    <label class="field"><span>&nbsp;</span><select id="rec-unit" aria-label="Unit">${R.UNITS.map((u) => `<option value="${u.id}" ${u.id === s.unit ? 'selected' : ''}>${u.many}</option>`).join('')}</select></label></div>
    ${s.unit === 'month' || s.unit === 'year' ? `<label class="field"><span>On this day of the month (optional)</span><input id="rec-dom" type="number" min="1" max="31" inputmode="numeric" value="${s.dom || ''}" placeholder="the day of the first date"></label>` : ''}`;
}

/** Copies the custom fields into the draft rule (call when the form is read). */
export function readCustom(sheet, r) {
  if (r.every !== 'custom') { delete r.n; delete r.unit; delete r.dom; return; }
  const n = Number(sheet.querySelector('#rec-n')?.value);
  r.n = Number.isFinite(n) && n >= 1 ? Math.min(999, Math.round(n)) : r.n || 1;
  r.unit = sheet.querySelector('#rec-unit')?.value || r.unit || 'month';
  const dom = Number(sheet.querySelector('#rec-dom')?.value);
  if (r.unit === 'month' || r.unit === 'year') r.dom = Number.isInteger(dom) && dom >= 1 && dom <= 31 ? dom : null;
  else r.dom = null;
}

// ---------- "Repeat this…" ----------

/** The starting values of a rule made from one record (it counts as the first one). */
export function presetFromTx(tx) {
  return {
    type: tx.type === 'income' ? 'income' : 'expense',
    amount: tx.amount,
    currency: tx.currency,
    account: tx.account,
    category: tx.category,
    note: tx.note || '',
    ...(tx.person ? { person: tx.person } : {}),
    every: 'month',
    start: tx.date,
    lastDone: tx.date,
    auto: false,
  };
}

// ---------- Rules that add themselves: Undo ----------

/** Takes back what a run added by itself: the records go (the deletion syncs) and stay gone. */
export function undoAdded(ids) {
  const { state } = ctx;
  const now = Date.now();
  let n = 0;
  for (const id of ids) if (M.removeTx(state, id, now)) n++;
  if (n) ctx.commit();
  return n;
}
