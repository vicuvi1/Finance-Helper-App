// Monthly reconciliation (js/reconcile.js): type the real balance from your
// bank or card, see the difference with the app's balance on that day, look
// at what could explain it, or add one labelled adjustment (Undo takes it
// back out). Every check is kept as a reconciliation point per account.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as R from '../reconcile.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { todayISO, isValidISO } from '../dates.js';

const SHOW = 12; // rows per cause list before "and N more"

// Accounts screen: one line while any account is due (more than 31 days).
export function dueLine() {
  const st = ctx.state;
  if (!st || st._sealed) return '';
  const due = R.reconDue(st, todayISO());
  if (!due.length) return '';
  const item = (d) => `<button type="button" class="chip" data-act="recon-open" data-id="${esc(d.account.id)}">${esc(d.account.name)} <span class="muted">${d.days == null ? 'never' : `${d.days} days`}</span></button>`;
  return `<div class="banner recon-due" data-testid="fin-recon-due"><p><b>Reconcile: due</b> · check these against your bank or card.</p><div class="chips">${due.map(item).join('')}</div></div>`;
}

const signed = (c, cur) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatMoney(Math.abs(c), cur)}`;

function causesHTML(st, acc, point) {
  const c = R.findCauses(st, acc.id, point.date, point.diff);
  const rows = (list) => `<div class="list">${list.slice(0, SHOW).map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>${list.length > SHOW ? `<p class="muted small">and ${list.length - SHOW} more</p>` : ''}`;
  const parts = [];
  if (c.exact.length) parts.push(`<h4>An entry of this amount</h4>${rows(c.exact)}`);
  if (c.duplicates.length) parts.push(`<h4>Possible duplicates (${c.duplicates.length})</h4>${c.duplicates.slice(0, SHOW).map(([a, b]) => `<div class="recon-pair">${ctx.txRow(a, { showDate: true })}${ctx.txRow(b, { showDate: true })}</div>`).join('')}`);
  if (c.missing.length) parts.push(`<h4>Recurring items not logged (${c.missing.length})</h4><div class="card" style="padding:4px 14px">${c.missing.slice(0, SHOW).map((x) => `<div class="split-row"><span>${esc(x.rule.note || 'Recurring item')} <span class="muted">${esc(x.date)}</span></span><b class="money">${esc(formatMoney(x.rule.amount, x.rule.currency || acc.currency))}</b></div>`).join('')}</div><p class="muted small">Log them from Plan if they really happened.</p>`);
  parts.push(`<h4>${c.since ? `Entries since your last reconciliation (${esc(c.since)})` : 'All entries up to this day'}: ${c.after.length}</h4>${c.after.length ? rows(c.after) : '<p class="muted small">None.</p>'}`);
  return `<div class="recon-causes" data-testid="rc-causes">${parts.join('')}</div>`;
}

function resultHTML(st, acc, point) {
  if (!point) return '';
  const cur = acc.currency || st.settings.currency;
  const s = R.pointStatus(st, point);
  const adj = point.adjustment ? st.tx.find((t) => t.id === point.adjustment) : null;
  const head = `<div class="recon-nums">
      <div><span>Bank says</span><b>${esc(formatMoney(point.real, cur))}</b></div>
      <div><span>App had</span><b>${esc(formatMoney(point.app, cur))}</b></div>
      <div><span>Difference</span><b class="${point.diff ? (point.diff > 0 ? 'income' : 'expense') : ''}">${esc(signed(point.diff, cur))}</b></div>
    </div>`;
  if (!point.diff) return `<div class="recon-result ok" data-testid="rc-result">${head}<p><b>Matches ✓</b> Saved as reconciled on ${esc(point.date)}.</p></div>`;
  if (adj) {
    return `<div class="recon-result" data-testid="rc-result">${head}
      <p data-testid="rc-adjusted">Adjustment added: <b>${esc(R.ADJUST_NOTE)}</b> ${esc(signed(adj.type === 'income' ? adj.amount : -adj.amount, adj.currency || cur))} on ${esc(point.date)}. It moves the balance only (not income or spending).</p>
      <div class="btns"><button type="button" class="btn" data-rc="undo" data-testid="rc-undo">Undo adjustment</button></div></div>`;
  }
  if (s.matched) return `<div class="recon-result ok" data-testid="rc-result">${head}<p><b>Matches now ✓</b> The entries were fixed after this check.</p></div>`;
  return `<div class="recon-result" data-testid="rc-result">${head}
    ${s.left !== point.diff ? `<p class="muted small">After your fixes the difference is now <b>${esc(signed(s.left, cur))}</b>.</p>` : ''}
    <p class="muted small">Look below for the cause and fix the entry (tap it), then compare again. Or settle it with one labelled entry.</p>
    <div class="btns"><button type="button" class="btn primary" data-rc="adjust" data-testid="rc-adjust">Add one adjustment of ${esc(signed(s.left, cur))}</button></div>
    ${causesHTML(st, acc, point)}</div>`;
}

function historyHTML(st, acc) {
  const list = R.reconsOf(st, acc.id).reverse();
  if (!list.length) return '';
  const cur = acc.currency || st.settings.currency;
  return `<details class="recon-history"><summary>Past reconciliations (${list.length})</summary>${list.map((p) => {
    const s = R.pointStatus(st, p);
    const label = !p.diff ? 'matched' : p.adjustment ? 'adjusted' : s.matched ? 'fixed' : `${signed(s.left, cur)} left`;
    return `<div class="split-row"><span>${esc(p.date)} <span class="muted">bank ${esc(formatMoney(p.real, cur))} · app ${esc(formatMoney(p.app, cur))}</span></span><span><b>${esc(label)}</b> <button type="button" class="icon-btn" data-rc="remove" data-id="${esc(p.id)}" aria-label="Remove the reconciliation of ${esc(p.date)}">✕</button></span></div>`;
  }).join('')}</details>`;
}

export function open(accountId, { date: presetDate } = {}) {
  const st0 = ctx.state;
  const acc = M.account(st0, accountId);
  if (!acc) return;
  const cur = acc.currency || st0.settings.currency;
  let date = presetDate && isValidISO(presetDate) ? presetDate : todayISO();
  let pointId = null;
  const body = () => {
    const st = ctx.state;
    const point = pointId ? (st.reconciliations || []).find((p) => p.id === pointId) : null;
    const last = R.lastRecon(st, acc.id);
    const app = R.appBalanceOn(st, acc.id, date);
    return `<h3>Reconcile ${esc(acc.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <p class="muted small" style="margin-top:0">${last ? `Last reconciled on ${esc(last.date)}.` : 'Not reconciled yet.'} Type the balance your bank or card shows for the end of the day.</p>
      <form id="rc-form" novalidate>
        <label class="field"><span>Day</span><input id="rc-date" type="date" value="${esc(date)}" max="${esc(todayISO())}"></label>
        <label class="field"><span>Real balance (${esc(cur)})</span><div class="amount-input"><input id="rc-real" data-testid="rc-real" type="text" inputmode="decimal" placeholder="${esc(centsToPlain(app))}" aria-label="Real balance"><span class="cur">${esc(cur)}</span></div></label>
        <p class="muted small" id="rc-app">The app has <b>${esc(formatMoney(app, cur))}</b> on that day.</p>
        <div class="btns"><button type="submit" class="btn primary" id="rc-check" data-testid="rc-check">Compare and save</button></div>
      </form>
      ${resultHTML(st, acc, point)}
      ${historyHTML(st, acc)}`;
  };
  ctx.openSheet(body(), (sheet) => {
    const paint = () => { const v = sheet.querySelector('#rc-real')?.value || ''; sheet.innerHTML = `<div class="grab"></div>${body()}`; const i = sheet.querySelector('#rc-real'); if (i && !pointId) i.value = v; };
    sheet.addEventListener('change', (e) => {
      if (e.target.id === 'rc-date' && isValidISO(e.target.value)) { date = e.target.value; pointId = null; paint(); }
    });
    sheet.addEventListener('submit', (e) => {
      if (e.target.id !== 'rc-form') return;
      e.preventDefault();
      const real = evalAmount(sheet.querySelector('#rc-real').value);
      if (real == null) { sheet.querySelector('#rc-real').focus(); return; }
      const p = R.addRecon(ctx.state, { account: acc.id, date, real });
      pointId = p.id;
      ctx.commit();
      paint();
      ctx.toast(p.diff ? `Difference of ${signed(p.diff, cur)} saved` : `${acc.name} matches your bank ✓`);
    });
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); return; }
      const b = e.target.closest('[data-rc]');
      if (!b) return;
      const st = ctx.state;
      const point = (st.reconciliations || []).find((p) => p.id === pointId);
      if (b.dataset.rc === 'adjust' && point) {
        // Settle what is left now (after any fixes), never more.
        const left = R.pointStatus(st, point).left;
        if (!left) { paint(); return; }
        const tx = R.adjustRecon(st, point, { diff: left, rate: cur === st.settings.currency ? 1 : ctx.suggestedRate(cur) });
        if (!tx) return;
        ctx.commit();
        paint();
        ctx.toast(`${R.ADJUST_NOTE} added`, 'Undo', () => { const p2 = (ctx.state.reconciliations || []).find((p) => p.id === point.id); if (R.undoAdjust(ctx.state, p2)) { ctx.commit(); if (sheet.isConnected) paint(); ctx.toast('Adjustment taken out'); } });
      } else if (b.dataset.rc === 'undo' && point) {
        if (!R.undoAdjust(st, point)) return;
        ctx.commit();
        paint();
        ctx.toast('Adjustment taken out');
      } else if (b.dataset.rc === 'remove') {
        const r = R.removeRecon(st, b.dataset.id);
        if (!r) return;
        if (b.dataset.id === pointId) pointId = null;
        ctx.commit();
        paint();
        ctx.toast(`Reconciliation of ${r.point.date} removed${r.tx ? ' with its adjustment' : ''}`, 'Undo', () => ctx.undo?.());
      }
    });
    sheet.querySelector('#rc-real')?.focus();
  });
}

export function onClick(act, el) {
  if (act !== 'recon-open') return false;
  open(el?.dataset?.id);
  return true;
}
