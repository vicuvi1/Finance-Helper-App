// Plan → Planned: big expenses coming (insurance, a holiday, a laptop), spread over
// the months until then. Numbers: js/planned.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { evalAmount, formatMoney } from '../money.js';
import { todayISO, monthLabel, addMonths } from '../dates.js';
import { plannedList, planStatus, addPlan, removePlan } from '../planned.js';

const draft = { name: '', amount: '', currency: '', month: '', keep: 'spending' };

export function tab() {
  const { state } = ctx;
  const today = todayISO();
  const base = state.settings.currency || 'MDL';
  const list = plannedList(state).map((p) => planStatus(state, p, today)).sort((a, b) => a.month.localeCompare(b.month));
  const live = list.filter((x) => !x.done);
  const perMonth = live.reduce((a, x) => a + x.perMonth, 0);
  const curs = [...new Set([base, 'USD', 'EUR'])];
  const next = addMonths(today.slice(0, 7), 3);
  const rows = list.map((x) => `<tr class="${x.done ? 'pl-done' : ''}" data-testid="plan-row">
      <td><b>${esc(x.name)}</b></td><td class="num">${esc(formatMoney(x.amount, x.currency))}</td><td>${esc(monthLabel(x.month))}</td>
      <td class="num">${x.done ? '—' : `<b>${esc(formatMoney(x.perMonth, base))}</b> a month`}</td>
      <td>${x.done ? 'Time to pay it' : `${esc(formatMoney(x.byNow, base))} by now · ${x.left} month${x.left === 1 ? '' : 's'} left`}</td>
      <td>${x.keep === 'savings' ? 'You move it to savings' : 'Kept back from Safe to spend'}</td>
      <td class="num"><button type="button" class="icon-btn" data-pl-act="delete" data-id="${esc(x.id)}" aria-label="Delete" title="Delete">🗑️</button></td></tr>`).join('');
  return `<section class="card" data-testid="planned-card">
    <div class="st-top"><div><h2 style="margin:0">Planned big expenses</h2>
      <p class="muted small" style="margin:4px 0 0">Spread over the months until then, so the money is there when it comes. ${live.length ? `Putting aside <b>${esc(formatMoney(perMonth, base))}</b> a month in total.` : ''}</p></div></div>
    <div class="st-wrap"><table class="st-table pl-table"><thead><tr><th>What</th><th>Amount</th><th>When</th><th>Put aside</th><th>So far</th><th>Where the money waits</th><th></th></tr></thead><tbody>
      ${rows || '<tr><td colspan="7" class="muted" style="padding:12px">Nothing planned yet. Add the first one below: insurance, a holiday, a new laptop, gifts in December…</td></tr>'}
      <tr class="st-new"><td><input class="st-in" data-pl="name" value="${esc(draft.name)}" placeholder="e.g. Car insurance"></td>
        <td><input class="st-in st-num" data-pl="amount" value="${esc(draft.amount)}" placeholder="0" inputmode="decimal"></td>
        <td><input class="st-in" type="month" data-pl="month" value="${esc(draft.month || next)}" min="${today.slice(0, 7)}"></td>
        <td><select class="st-in" data-pl="currency">${curs.map((c) => `<option ${c === (draft.currency || base) ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
        <td colspan="2"><select class="st-in" data-pl="keep"><option value="spending" ${draft.keep !== 'savings' ? 'selected' : ''}>It stays in my spending money</option><option value="savings" ${draft.keep === 'savings' ? 'selected' : ''}>I move it to savings</option></select></td>
        <td><button type="button" class="btn primary sm" data-pl-act="add" data-testid="plan-add">Add</button></td></tr>
    </tbody></table></div>
    <p class="muted small" style="margin-bottom:0">When the month comes, log the payment as usual. "It stays in my spending money": Safe to spend keeps what should be put aside by now out of what you can spend today.</p>
  </section>`;
}

function add() {
  const { state } = ctx;
  const amount = evalAmount(draft.amount);
  if (!draft.name.trim()) { ctx.toast('What is it for? e.g. Car insurance'); return; }
  if (!(amount > 0)) { ctx.toast('How much will it cost?'); return; }
  const today = todayISO();
  const month = draft.month || addMonths(today.slice(0, 7), 3);
  if (month < today.slice(0, 7)) { ctx.toast('Pick this month or later'); return; }
  addPlan(state, { ...draft, amount, month, currency: draft.currency || state.settings.currency }, { id: M.uid(), today });
  Object.assign(draft, { name: '', amount: '', month: '' });
  ctx.commit();
  ctx.toast('Planned', 'Undo', () => ctx.undo());
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  const keep = (el) => { if (el?.dataset?.pl) draft[el.dataset.pl] = el.value; };
  document.addEventListener('input', (e) => keep(e.target));
  document.addEventListener('change', (e) => keep(e.target));
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target?.dataset?.pl) { e.preventDefault(); keep(e.target); add(); } });
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-pl-act]');
    if (!b) return;
    if (b.dataset.plAct === 'add') add();
    else if (b.dataset.plAct === 'delete' && removePlan(ctx.state, b.dataset.id)) { ctx.commit(); ctx.toast('Deleted', 'Undo', () => ctx.undo()); }
  });
}
