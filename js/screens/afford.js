// "Can I afford it?" (a sheet on Money Home). Type a price: safe to spend
// before and after, the days this month the money runs short, how much later
// each goal is reached, and one plain verdict. Read only: it never makes a
// record. "Add to wishlist instead" puts it on the wishlist (js/wishlist.js).

import { ctx, esc } from '../ctx.js';
import { formatMoney, evalAmount } from '../money.js';
import { todayISO, isValidISO } from '../dates.js';
import { affordCheck } from '../afford.js';
import { addItem, summary } from '../wishlist.js';

// The Money Home row: the three money ideas, one tap each.
export function homeRow() {
  const { state } = ctx;
  const n = summary(state).waiting.length;
  return `<div class="mi-row" role="group" aria-label="Money ideas">
    <button type="button" class="btn sm" data-act="afford-open" data-testid="afford-open">Can I afford it?</button>
    <button type="button" class="btn sm" data-go="calendar" data-testid="calendar-open">Money calendar</button>
    <button type="button" class="btn sm" data-go="wishlist" data-testid="wishlist-open">Wishlist${n ? ` (${n})` : ''}</button>
  </div>`;
}

const weeksText = (w) => (w >= 8 ? `about ${Math.round(w / 4.345)} months later` : `about ${w} week${w === 1 ? '' : 's'} later`);

function resultHTML(r, cur) {
  const f = (c) => formatMoney(Math.round(c / 100) * 100, cur);
  const day = r.date === todayISO() ? 'today' : 'on that day';
  const goals = r.goals.length
    ? `<h4 class="mc-h">Your goals</h4><ul class="af-goals">${r.goals.map((g) => `<li><span>${esc(g.emoji)} ${esc(g.name)}</span><b>${g.weeks ? weeksText(g.weeks) : g.remaining > 0 ? 'no pace yet' : 'already reached'}</b></li>`).join('')}</ul>`
    : '';
  return `<p class="af-verdict tone-${r.tone}" data-testid="afford-verdict" role="status">${esc(r.verdict)}</p>
    <div class="af-rows">
      <div class="split-row"><span>Safe to spend ${day}</span><b data-testid="afford-safe">${f(r.before.leftToday)} → ${f(r.after.leftToday)}</b></div>
      <div class="split-row"><span>Days this month the money runs short</span><b data-testid="afford-short">${r.tightDays ? `${r.tightDays}${r.tightUntil ? ` (until ${Number(r.tightUntil.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(r.tightUntil.slice(5, 7)) - 1]})` : ''}` : 'none'}</b></div>
      ${r.overLimit ? `<div class="split-row"><span>Over your monthly limit by</span><b class="expense">${f(r.overLimit)}</b></div>` : ''}
    </div>${goals}
    <p class="muted small">Nothing is saved: this only shows what would change.</p>`;
}

export function openSheet() {
  const { state } = ctx;
  const cur = state.settings.currency;
  const today = todayISO();
  ctx.openSheet(`<h3>Can I afford it? <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <label class="field"><span>Price (${esc(cur)})</span><input id="af-price" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Price"></label>
    <label class="field"><span>What is it (optional)</span><input id="af-name" type="text" autocomplete="off" placeholder="e.g. Headphones" aria-label="Name"></label>
    <label class="field"><span>When</span><input id="af-date" type="date" value="${today}" min="${today}" aria-label="Date"></label>
    <div id="af-out" aria-live="polite"></div>
    <div class="btns" style="margin-top:12px"><button type="button" class="btn" id="af-wish" disabled>Add to wishlist instead</button><button type="button" class="btn" data-close>Close</button></div>`, (sheet) => {
    const price = sheet.querySelector('#af-price');
    const out = sheet.querySelector('#af-out');
    const wish = sheet.querySelector('#af-wish');
    const read = () => {
      const c = evalAmount(price.value);
      return c && c > 0 ? c : null;
    };
    const update = () => {
      const c = read();
      wish.disabled = !c;
      if (!c) { out.innerHTML = '<p class="muted">Type a price to see what it would do.</p>'; return; }
      const dv = sheet.querySelector('#af-date').value;
      out.innerHTML = resultHTML(affordCheck(ctx.state, todayISO(), { price: c, date: isValidISO(dv) ? dv : todayISO() }), cur);
    };
    sheet.addEventListener('input', update);
    sheet.addEventListener('change', update);
    wish.addEventListener('click', () => {
      const c = read();
      if (!c) return;
      const name = sheet.querySelector('#af-name').value.trim() || 'Something I want';
      addItem(ctx.state, { name, price: c }, todayISO());
      ctx.persistSync();
      ctx.closeSheet();
      ctx.toast(`Added to your wishlist. You can buy it after the wait.`);
      if (ctx.ui.tab === 'wishlist') ctx.render();
    });
    update();
    price.focus();
  });
}

export function onClick(act) {
  if (act !== 'afford-open') return false;
  openSheet();
  return true;
}

