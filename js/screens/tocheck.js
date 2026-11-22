// The "To check" sheet: payments recorded by themselves, one row each with category and card,
// ✓ to keep, 🗑 to delete. Logic: js/tocheck.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { formatMoney } from '../money.js';
import { dayLabel } from '../dates.js';
import { toCheck, approve, approveAll } from '../tocheck.js';

export function open() {
  const { state } = ctx;
  const list = toCheck(state);
  if (!list.length) { ctx.toast('Nothing to check: all done ✓'); if (document.querySelector('.sheet')) ctx.closeSheet(); return; }
  const cats = (type) => state.settings.categories.filter((c) => !c.archived && (c.type || 'expense') === (type === 'income' ? 'income' : 'expense'));
  const accs = M.activeAccounts(state);
  const row = (t) => `<div class="tc-row" data-testid="tc-row" data-id="${esc(t.id)}">
    <div class="tc-top"><b>${esc(t.note || 'Payment')}</b><b class="${t.type === 'income' ? 'income' : ''}">${t.type === 'income' ? '+' : '−'}${esc(formatMoney(t.amount, t.currency))}</b></div>
    <div class="muted small">${esc(dayLabel(t.date))}</div>
    <div class="tc-edit">
      <select data-tc="category" aria-label="Category">${cats(t.type).map((c) => `<option value="${esc(c.id)}" ${c.id === t.category ? 'selected' : ''}>${esc(`${c.emoji || ''} ${c.name}`.trim())}</option>`).join('')}</select>
      <select data-tc="account" aria-label="Card">${accs.filter((a) => (a.currency || state.settings.currency) === t.currency || a.id === t.account).map((a) => `<option value="${esc(a.id)}" ${a.id === t.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <button type="button" class="btn primary sm" data-tc-act="ok" data-testid="tc-ok">✓</button>
      <button type="button" class="icon-btn" data-tc-act="delete" aria-label="Delete" title="Delete">🗑️</button>
    </div></div>`;
  if (document.querySelector('.sheet')) ctx.closeSheet();
  ctx.openSheet(`<h3>${list.length} payment${list.length === 1 ? '' : 's'} to check <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted" style="margin-top:0">Recorded by themselves from your phone. They already count; check the category and card once. What you pick here is what the next payment at the same shop gets.</p>
    <div class="tc-list">${list.map(row).join('')}</div>
    <div class="btns"><button type="button" class="btn" data-close>Later</button><button type="button" class="btn primary" data-tc-act="all" data-testid="tc-all">All look right ✓</button></div>`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tc-act]');
      if (!b) return;
      if (b.dataset.tcAct === 'all') {
        const n = approveAll(ctx.state);
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${n} checked ✓`);
        return;
      }
      const rowEl = b.closest('.tc-row');
      const id = rowEl?.dataset.id;
      if (!id) return;
      if (b.dataset.tcAct === 'ok') {
        approve(ctx.state, id, { category: rowEl.querySelector('[data-tc="category"]').value, account: rowEl.querySelector('[data-tc="account"]').value });
        ctx.commit();
      } else if (b.dataset.tcAct === 'delete') {
        const t = ctx.state.tx.find((x) => x.id === id);
        if (t) { ctx.state.tx = ctx.state.tx.filter((x) => x.id !== id); ctx.state.deleted = { ...(ctx.state.deleted || {}), [id]: Date.now() }; ctx.commit(); ctx.toast('Deleted'); }
      }
      open();
    });
  });
}
