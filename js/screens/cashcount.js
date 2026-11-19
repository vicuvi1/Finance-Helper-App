// "Count your cash" card on Money Home (js/cashcount.js) and its settings.
// A different count adds one "Cash count" record (Undo); "Same as the app"
// only saves the check date. Not a notification, just a card.

import { ctx, esc } from '../ctx.js';
import * as CC from '../cashcount.js';
import { accountBalances } from '../model.js';
import { evalAmount, formatMoney } from '../money.js';
import { todayISO } from '../dates.js';

export function card(today = todayISO()) {
  const due = CC.cashCountDue(ctx.state, today);
  if (!due) return '';
  const bal = accountBalances(ctx.state);
  const first = due.accounts[0];
  const picker = due.accounts.length > 1
    ? `<select data-cash-account aria-label="Cash account">${due.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>`
    : `<b>${esc(first.name)}</b>`;
  return `<section class="card cash-count" data-testid="cash-count-card" data-cash-card>
    <h2>Count your cash</h2>
    <p style="margin-top:0">How much is in ${picker}? <span class="muted small">The app says ${esc(formatMoney(bal[first.id] || 0, first.currency))}.</span></p>
    <div class="cash-count-row">
      <input type="text" inputmode="decimal" data-cash-amount placeholder="Amount you counted" aria-label="Cash you counted" data-testid="cash-count-input">
      <button type="button" class="btn primary" data-act="cash-count-save" data-testid="cash-count-save">Save count</button>
      <button type="button" class="btn" data-act="cash-count-same" data-testid="cash-count-same">Same as the app</button>
    </div></section>`;
}

export function settingsCard() {
  const c = CC.cashCountConfig(ctx.state);
  return `<section class="card"><h2>Weekly cash count</h2>
    <p class="muted small" style="margin-top:0">Once a week Home asks you to count the cash in your cash account. Only a card, no notification.</p>
    <label class="motion-setting"><span><b>Ask me to count my cash</b></span><input type="checkbox" data-set="cashCountOn" ${c.on ? 'checked' : ''} aria-label="Weekly cash count"></label>
    <label class="field" style="margin:10px 0 0"><span>Day of the week</span><select data-set="cashCountDay" aria-label="Cash count day">${CC.DAY_NAMES.map((n, i) => `<option value="${i}"${i === c.day ? ' selected' : ''}>${n}</option>`).join('')}</select></label></section>`;
}

// Returns true when the action belongs to this card.
export function onClick(act, el) {
  if (act !== 'cash-count-save' && act !== 'cash-count-same') return false;
  const box = el.closest('[data-cash-card]');
  const today = todayISO();
  const state = ctx.state;
  const due = CC.cashCountDue(state, today);
  if (!box || !due) return true;
  const id = box.querySelector('[data-cash-account]')?.value || due.accounts[0].id;
  const acc = due.accounts.find((a) => a.id === id) || due.accounts[0];
  if (act === 'cash-count-same') {
    CC.markCashSame(state, today);
    ctx.commit();
    ctx.toast('Cash count saved: same as the app', 'Undo', () => ctx.undo?.());
    return true;
  }
  const counted = evalAmount(box.querySelector('[data-cash-amount]').value);
  if (counted == null || !(counted >= 0) || !Number.isFinite(counted)) { ctx.toast('Type the cash you counted, e.g. 450 or 200+250'); return true; }
  const base = state.settings.currency;
  const rate = acc.currency === base ? 1 : ctx.suggestedRate?.(acc.currency);
  if (!rate) { ctx.toast(`No ${acc.currency} rate yet. Update rates first.`); return true; }
  const r = CC.applyCashCount(state, acc.id, counted, today, { rate });
  ctx.commit();
  if (!r.tx) ctx.toast('Cash count saved: same as the app', 'Undo', () => ctx.undo?.());
  else ctx.toast(`Cash count saved: ${r.diff > 0 ? 'added' : 'removed'} ${formatMoney(Math.abs(r.diff), acc.currency)}`, 'Undo', () => ctx.undo?.());
  return true;
}
