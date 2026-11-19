// Small money clean-up tools in the Log: "Find duplicates" (js/dupes.js), the
// "Looks like a refund?" list (js/refunds.js), and the exchange-rate date chip
// (js/ratedate.js). Nothing here changes a record until you tap, and every
// change is one Undo step.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as D from '../dupes.js';
import * as R from '../refunds.js';
import * as NI from '../notincome.js';
import * as RD from '../ratedate.js';
import { todayISO } from '../dates.js';
import { formatMoney } from '../money.js';

// ---------- Exchange rate date ----------

// "rate from 12 Nov", plus a quiet chip with "Update rates" when the newest
// rate is more than 3 days old (or an "offline" note instead of the button).
export function rateDateHTML({ today = todayISO(), online = typeof navigator === 'undefined' || navigator.onLine !== false } = {}) {
  const st = RD.rateStatus(ctx.state?.rates, today);
  if (st.none) return '';
  const text = RD.rateFromText(st.date);
  const chip = st.stale
    ? ` <span class="rate-stale" data-testid="rate-stale" style="display:inline-flex;gap:6px;align-items:center;padding:1px 8px;border-radius:999px;background:color-mix(in srgb, var(--gold, #e3b95f) 18%, transparent);font-size:12px">${st.days} days old${online
      ? ' <button type="button" class="btn sm" data-act="rate-update" data-testid="rate-update">Update rates</button>'
      : ' · you are offline, rates update when you are back online'}</span>`
    : '';
  return `<span class="rate-date" data-testid="rate-date">${esc(text)}</span>${chip}`;
}

export function updateRates() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { ctx.toast('You are offline, so rates cannot update now.'); return; }
  ctx.updateRates({ force: true, announce: true });
}

// ---------- Duplicates ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export function openDuplicates() {
  const keep = new Map(); // group id -> record id to keep
  const body = () => {
    const groups = D.findDuplicates(ctx.state);
    for (const g of groups) if (!keep.has(g.id) || !g.records.some((r) => r.id === keep.get(g.id))) keep.set(g.id, g.keep);
    if (!groups.length) {
      return `<h3>Find duplicates <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
        <p data-testid="dupes-none"><b>No duplicates found.</b> Same amount, account and type, a day apart at most, with a similar note.</p>`;
    }
    const total = groups.reduce((a, g) => a + g.records.length - 1, 0);
    return `<h3>Find duplicates <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <p class="muted small" style="margin-top:0">${groups.length} group${groups.length === 1 ? '' : 's'} of records that look the same. Pick the one to keep in each; the others are removed (one Undo brings them all back). A backup is saved first.</p>
      ${groups.map((g) => `<section class="card dupe-group" data-group="${esc(g.id)}" data-testid="dupe-group" style="padding:8px 12px;margin-bottom:10px">
        ${g.records.map((t) => `<label class="dupe-row" style="display:flex;gap:10px;align-items:center;padding:6px 0">
          <input type="radio" name="keep-${esc(g.id)}" value="${esc(t.id)}" ${keep.get(g.id) === t.id ? 'checked' : ''} aria-label="Keep this one">
          <span style="flex:1;min-width:0"><b>${esc(t.note || M.category(ctx.state, t.category)?.name || 'Record')}</b><br><span class="muted small">${esc(dayText(t.date))} · ${esc(M.account(ctx.state, t.account)?.name || '')}</span></span>
          <span class="money">${esc(formatMoney(t.amount, t.currency))}</span>
        </label>`).join('')}
        <div class="btns" style="margin:6px 0 0"><button type="button" class="btn sm" data-dupe="not" data-group="${esc(g.id)}" data-testid="dupe-not">Not a duplicate</button></div>
      </section>`).join('')}
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn danger" data-dupe="remove" data-testid="dupes-remove">Remove ${total} record${total === 1 ? '' : 's'}</button></div>`;
  };
  ctx.openSheet(body(), (sheet) => {
    const paint = () => { sheet.innerHTML = `<div class="grab"></div>${body()}`; };
    sheet.addEventListener('change', (e) => {
      if (e.target.matches('input[type=radio]')) keep.set(e.target.closest('[data-group]').dataset.group, e.target.value);
    });
    sheet.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-dupe]');
      if (!b) return;
      if (b.dataset.dupe === 'not') {
        const g = D.findDuplicates(ctx.state).find((x) => x.id === b.dataset.group);
        if (!g) return;
        D.markNotDuplicate(ctx.state, g.records.map((r) => r.id));
        ctx.commit();
        paint();
        ctx.toast('Marked as not a duplicate', 'Undo', () => ctx.undo?.());
        return;
      }
      if (b.dataset.dupe === 'remove') {
        const count = D.findDuplicates(ctx.state).reduce((a, g) => a + g.records.length - 1, 0);
        if (!count) return;
        b.disabled = true;
        const bk = await D.backupBefore(`removing ${count} duplicate record${count === 1 ? '' : 's'}`);
        if (!bk.ok) { b.disabled = false; ctx.toast(`Nothing was removed: ${bk.error}`); return; }
        // Read again: the data may have changed while the backup was made.
        const picks = D.findDuplicates(ctx.state).map((g) => ({ keep: keep.get(g.id) || g.keep, ids: g.records.map((r) => r.id) }));
        const gone = D.removeDuplicates(ctx.state, picks);
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`Removed ${gone.length} duplicate record${gone.length === 1 ? '' : 's'}`, 'Undo', () => ctx.undo?.());
      }
    });
  });
}

// ---------- "Looks like a refund?" ----------

export function openRefundSuggestions() {
  const body = () => {
    const list = R.refundSuggestions(ctx.state);
    const cats = ctx.state.settings.categories;
    const name = (id) => cats.find((c) => c.id === id)?.name || 'Other';
    if (!list.length) return `<h3>Looks like a refund? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3><p data-testid="refund-none"><b>Nothing to suggest.</b></p>`;
    return `<h3>Looks like a refund? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <p class="muted small" style="margin-top:0">Money you logged as income with "refund", "return" or "rambursare" in the note. A refund lowers its category's spending instead of counting as income. Nothing changes until you tap.</p>
      ${list.slice(0, 20).map((t) => { const cat = R.guessRefundCategory(ctx.state, t); return `<div class="split-row" data-refund="${esc(t.id)}" data-testid="refund-suggestion" style="gap:8px;flex-wrap:wrap">
        <span style="flex:1;min-width:140px"><b>${esc(t.note)}</b><br><span class="muted small">${esc(dayText(t.date))} · ${esc(formatMoney(t.amount, t.currency))}</span></span>
        <span class="btns" style="margin:0">${cat ? `<button type="button" class="btn sm primary" data-rf="mark" data-id="${esc(t.id)}" data-cat="${esc(cat)}">Mark as refund in ${esc(name(cat))}</button>` : ''}<button type="button" class="btn sm" data-rf="pick" data-id="${esc(t.id)}">Pick category</button><button type="button" class="btn sm" data-rf="no" data-id="${esc(t.id)}">Not a refund</button></span>
      </div>`; }).join('')}`;
  };
  ctx.openSheet(body(), (sheet) => {
    const paint = () => { sheet.innerHTML = `<div class="grab"></div>${body()}`; };
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rf]');
      if (!b) return;
      const t = ctx.state.tx.find((x) => x.id === b.dataset.id);
      if (!t) return;
      if (b.dataset.rf === 'pick') { ctx.closeSheet(); ctx.openTxSheet({ ...t, refund: true, category: null }); return; }
      if (b.dataset.rf === 'mark') {
        if (!R.markRefund(ctx.state, t, b.dataset.cat)) return;
        ctx.commit();
        paint();
        ctx.toast('Marked as a refund', 'Undo', () => ctx.undo?.());
      } else if (b.dataset.rf === 'no') {
        R.dismissRefund(t);
        ctx.commit();
        paint();
        ctx.toast('Got it, no more suggestion for this one', 'Undo', () => ctx.undo?.());
      }
    });
  });
}

// ---------- "Not income?" ----------

export function openNotIncomeSuggestions() {
  const body = () => {
    const list = NI.notIncomeSuggestions(ctx.state);
    const head = `<h3>Not income? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>`;
    if (!list.length) return `${head}<p data-testid="notincome-none"><b>Nothing to suggest.</b></p>`;
    return `${head}
      <p class="muted small" style="margin-top:0">Earned records in "Other income" with no note. If it was money you already had, mark it: the balance stays, but it is left out of Earned and savings. Nothing changes until you tap.</p>
      ${list.slice(0, 20).map((t) => `<div class="split-row" data-notincome="${esc(t.id)}" data-testid="notincome-suggestion" style="gap:8px;flex-wrap:wrap">
        <span style="flex:1;min-width:140px"><b>${esc(formatMoney(t.amount, t.currency))}</b><br><span class="muted small">${esc(dayText(t.date))} · ${esc(M.account(ctx.state, t.account)?.name || '')}</span></span>
        <span class="btns" style="margin:0"><button type="button" class="btn sm primary" data-ni="mark" data-id="${esc(t.id)}">Not income</button><button type="button" class="btn sm" data-ni="no" data-id="${esc(t.id)}">It is income</button></span>
      </div>`).join('')}
      ${list.length > 1 ? `<div class="btns"><button type="button" class="btn" data-ni="all" data-testid="notincome-all">Mark all ${list.length} as not income</button></div>` : ''}`;
  };
  ctx.openSheet(body(), (sheet) => {
    const paint = () => { sheet.innerHTML = `<div class="grab"></div>${body()}`; };
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ni]');
      if (!b) return;
      if (b.dataset.ni === 'all') {
        const list = NI.notIncomeSuggestions(ctx.state);
        let n = 0;
        for (const t of list) if (NI.markNotIncome(t)) n++;
        if (!n) return;
        ctx.commit();
        paint();
        ctx.toast(`Marked ${n} as not income`, 'Undo', () => ctx.undo?.());
        return;
      }
      const t = ctx.state.tx.find((x) => x.id === b.dataset.id);
      if (!t) return;
      if (b.dataset.ni === 'mark') {
        if (!NI.markNotIncome(t)) return;
        ctx.commit();
        paint();
        ctx.toast('Marked as not income', 'Undo', () => ctx.undo?.());
      } else if (b.dataset.ni === 'no') {
        NI.dismissNotIncome(t);
        ctx.commit();
        paint();
        ctx.toast('Got it, no more suggestion for this one', 'Undo', () => ctx.undo?.());
      }
    });
  });
}

// The buttons for the Log's action row (the refund one only when there is something to suggest).
export function logButtons() {
  const n = ctx.state ? R.refundSuggestions(ctx.state).length : 0;
  const ni = ctx.state ? NI.notIncomeSuggestions(ctx.state).length : 0;
  const niBtn = ni ? `<button type="button" class="btn" data-act="notincome-open" data-testid="notincome-open" title="Earned records in Other income with no note">Not income? (${ni})</button>` : '';
  return `<button type="button" class="btn" data-act="dupes-open" data-testid="dupes-open" title="Find records that look entered twice">Find duplicates</button>${n ? `<button type="button" class="btn" data-act="refunds-open" data-testid="refunds-open" title="Income records that look like refunds">Looks like a refund? (${n})</button>` : ''}${niBtn}`;
}

export function onClick(act) {
  if (act === 'dupes-open') { openDuplicates(); return true; }
  if (act === 'refunds-open') { openRefundSuggestions(); return true; }
  if (act === 'notincome-open') { openNotIncomeSuggestions(); return true; }
  if (act === 'rate-update') { updateRates(); return true; }
  return false;
}
