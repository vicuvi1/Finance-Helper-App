// "Re-price N past entries" (one-time review): records in another currency
// that were counted 1:1 in the main currency. A banner on Home opens a list
// with the value before and after; nothing changes until you confirm. Every
// re-priced record keeps its old values (`repricedFrom`), and Undo puts them
// back. Never applied on its own.

import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { repriceRows, applyReprice, repriced, undoReprice } from '../reprice.js';

const s = (n) => (n === 1 ? 'entry' : 'entries');

// Home: the banner while there is something to review (or to undo).
export function banner() {
  const st = ctx.state;
  if (!st || st._sealed) return '';
  const rows = repriceRows(st);
  const done = repriced(st).length;
  if (!rows.length && !done) return '';
  if (!rows.length) return `<div class="banner reprice-banner" data-testid="reprice-undo-banner"><p>${done} past ${s(done)} re-priced with the right rate.</p><button class="btn" data-act="reprice-open">Review or undo</button></div>`;
  return `<div class="banner reprice-banner" data-testid="reprice-banner"><p><b>${rows.length} past ${s(rows.length)} in another currency were counted 1:1</b> (for example 10 EUR as 10 ${esc(st.settings.currency)}).</p><button class="btn primary" data-act="reprice-open">Re-price ${rows.length} past ${s(rows.length)}</button></div>`;
}

function sheetHTML() {
  const st = ctx.state;
  const base = st.settings.currency;
  const rows = repriceRows(st);
  const done = repriced(st);
  const line = (r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.note || (r.type === 'income' ? 'Income' : 'Expense'))}</td><td class="num">${esc(formatMoney(r.amount, r.currency))}</td><td class="num"><s class="muted">${esc(formatMoney(r.before, base))}</s></td><td class="num"><b>${esc(formatMoney(r.after, base))}</b></td></tr>`;
  const table = rows.length ? `<p style="margin-top:0">These were counted as if 1 ${esc(rows[0].currency)} = 1 ${esc(base)}. With the rate of each day (or today's when the day's rate isn't saved) they become:</p>
    <div class="ic-wrap"><table class="ic-table reprice-table"><thead><tr><th>Day</th><th>What</th><th class="num">Amount</th><th class="num">Was</th><th class="num">Now</th></tr></thead><tbody>${rows.map(line).join('')}</tbody></table></div>
    <p class="muted small">The amounts you typed stay the same; only their value in ${esc(base)} changes. Each record keeps its old value, so you can undo this.</p>` : '<p style="margin-top:0">Nothing left to re-price.</p>';
  const undo = done.length ? `<p class="muted small" data-testid="reprice-undo-line">${done.length} ${s(done.length)} re-priced before. <button type="button" class="btn small" data-reprice="undo">Undo re-price</button></p>` : '';
  return `<h3>Re-price past entries <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    ${table}${undo}
    <div class="btns"><button class="btn" data-close>Not now</button>${rows.length ? `<button class="btn primary" data-reprice="apply">Re-price ${rows.length} ${s(rows.length)}</button>` : ''}</div>`;
}

export function open() {
  ctx.openSheet(sheetHTML(), (sheet) => {
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-reprice]');
      if (!b) return;
      if (b.dataset.reprice === 'apply') {
        const rows = repriceRows(ctx.state);
        const n = applyReprice(ctx.state, rows);
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`Re-priced ${n} ${s(n)}`, 'Undo', () => { const k = undoReprice(ctx.state, rows.map((r) => r.id)); ctx.commit(); ctx.toast(`Put back ${k} ${s(k)}`); });
      } else if (b.dataset.reprice === 'undo') {
        const k = undoReprice(ctx.state);
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`Put back ${k} ${s(k)} as they were`);
      }
    });
  });
}

export function onClick(act) {
  if (act !== 'reprice-open') return false;
  open();
  return true;
}
