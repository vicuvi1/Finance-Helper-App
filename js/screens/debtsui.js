// Plan → Debts: a bank loan or credit card with its rate and monthly payment.
// Hidden until you add one (from Plan → Planned). Numbers: js/debts.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { evalAmount, formatMoney } from '../money.js';
import { todayISO, monthLabel } from '../dates.js';
import { debtList, debtStatus, addDebt, setBalance, removeDebt, payMore } from '../debts.js';

const draft = { kind: 'loan', name: '', balance: '', rate: '', payment: '', day: '' };

export const hasDebts = (state) => debtList(state).length > 0;

export function tab() {
  const { state } = ctx;
  const today = todayISO();
  const base = state.settings.currency || 'MDL';
  const list = debtList(state).map((d) => debtStatus(state, d, today));
  const total = list.reduce((a, d) => a + (d.currency === base ? d.left : 0), 0);
  const fmt = (c, cur) => esc(formatMoney(c, cur || base));
  const rows = list.map((d) => {
    const more = !d.done && !d.never ? payMore(d, d.left, Math.max(10000, Math.round(d.payment * 0.2 / 10000) * 10000)) : null;
    return `<tr data-testid="debt-row"><td><b>${d.kind === 'card' ? '💳' : '🏦'} ${esc(d.name)}</b><br><small class="muted">${d.rate}% a year</small></td>
      <td class="num"><input class="st-in st-num" value="${(d.left / 100).toFixed(0)}" data-debt-balance="${esc(d.id)}" aria-label="What you owe now" title="Type what the bank's app says you owe now"></td>
      <td class="num">${fmt(d.payment, d.currency)}<br><small class="muted">on the ${d.day}${['st', 'nd', 'rd'][((d.day + 90) % 100 - 10) % 10 - 1] || 'th'}</small></td>
      <td>${d.done ? '✓ Paid off' : d.never ? '<b class="expense">Never</b>: the payment doesn\'t cover the interest' : `<b>${esc(monthLabel(d.payoff))}</b><br><small class="muted">${d.months} payment${d.months === 1 ? '' : 's'} left</small>`}</td>
      <td class="num">${d.interestLeft == null ? '—' : fmt(d.interestLeft, d.currency)}<br><small class="muted">${fmt(d.interestMonth, d.currency)} this month</small></td>
      <td class="small">${more && more.months ? `Pay ${fmt(Math.max(10000, Math.round(d.payment * 0.2 / 10000) * 10000), d.currency)} more a month: done <b>${more.months} month${more.months === 1 ? '' : 's'}</b> sooner${more.saved ? `, ${fmt(more.saved, d.currency)} less interest` : ''}.` : ''}</td>
      <td class="num"><button type="button" class="icon-btn" data-debt-act="delete" data-id="${esc(d.id)}" aria-label="Remove" title="Remove">🗑️</button></td></tr>`;
  }).join('');
  return `<section class="card" data-testid="debts-card">
    <div class="st-top"><div><h2 style="margin:0">Debts</h2>
      <p class="muted small" style="margin:4px 0 0">${list.length ? `You owe <b>${fmt(total)}</b>${list.length > 1 ? ' in total' : ''}. Each monthly payment is a repeating bill (To confirm, Safe to spend).` : 'A bank loan or credit card: what\'s left, when it\'s paid off and the interest still to pay.'}</p></div></div>
    <div class="st-wrap"><table class="st-table debt-table"><colgroup><col style="width:19%"><col style="width:12%"><col style="width:12%"><col style="width:13%"><col style="width:13%"><col><col style="width:48px"></colgroup><thead><tr><th>What</th><th>Owed now</th><th>A month</th><th>Paid off</th><th>Interest left</th><th>Faster</th><th></th></tr></thead><tbody>
      ${rows}
      <tr class="st-new">
        <td><select class="st-in" data-debt="kind"><option value="loan" ${draft.kind !== 'card' ? 'selected' : ''}>🏦 Loan</option><option value="card" ${draft.kind === 'card' ? 'selected' : ''}>💳 Credit card</option></select><input class="st-in" data-debt="name" value="${esc(draft.name)}" placeholder="Name, e.g. maib loan" style="margin-top:4px"></td>
        <td><input class="st-in st-num" data-debt="balance" value="${esc(draft.balance)}" placeholder="Owed now" inputmode="decimal"></td>
        <td><input class="st-in st-num" data-debt="payment" value="${esc(draft.payment)}" placeholder="A month" inputmode="decimal"><input class="st-in st-num" data-debt="day" value="${esc(draft.day)}" placeholder="Day (1-28)" inputmode="numeric" style="margin-top:4px"></td>
        <td colspan="2"><input class="st-in st-num" data-debt="rate" value="${esc(draft.rate)}" placeholder="Interest % a year" inputmode="decimal"></td>
        <td colspan="2"><button type="button" class="btn primary sm" data-debt-act="add" data-testid="debt-add">Add</button></td></tr>
    </tbody></table></div>
    <p class="muted small" style="margin-bottom:0">Not the same as People &amp; loans (money between you and people you know). Removing a debt pauses its monthly bill; past payments stay in your records.</p>
  </section>`;
}

function add() {
  const { state } = ctx;
  const balance = evalAmount(draft.balance);
  const payment = evalAmount(draft.payment) || 0;
  if (!(balance > 0)) { ctx.toast('How much do you owe now?'); return; }
  if (!(payment > 0)) { ctx.toast('How much do you pay a month?'); return; }
  const today = todayISO();
  addDebt(state, { ...draft, balance, payment, rate: Number(String(draft.rate).replace(',', '.')) || 0 }, { id: M.uid(), ruleId: M.uid(), today });
  Object.assign(draft, { name: '', balance: '', rate: '', payment: '', day: '' });
  ctx.commit();
  ctx.toast('Added, with its monthly payment as a bill', 'Undo', () => ctx.undo());
}

let bound = false;
export function init() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  const keep = (el) => { if (el?.dataset?.debt) draft[el.dataset.debt] = el.value; };
  document.addEventListener('input', (e) => keep(e.target));
  document.addEventListener('change', (e) => {
    keep(e.target);
    const id = e.target?.dataset?.debtBalance;
    if (id) {
      const v = evalAmount(e.target.value);
      if (v >= 0 && setBalance(ctx.state, id, v, { today: todayISO() })) { ctx.commit(); ctx.toast('Updated', 'Undo', () => ctx.undo()); }
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target?.dataset?.debt) { e.preventDefault(); keep(e.target); add(); } });
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-debt-act]');
    if (!b) return;
    if (b.dataset.debtAct === 'add') add();
    else if (b.dataset.debtAct === 'delete' && removeDebt(ctx.state, b.dataset.id)) { ctx.commit(); ctx.toast('Removed; its monthly bill is paused', 'Undo', () => ctx.undo()); }
  });
}
