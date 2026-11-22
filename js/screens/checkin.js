// The 10-minute Sunday check-in screen (numbers: js/checkin.js).

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { formatMoney } from '../money.js';
import { todayISO, dayLabel } from '../dates.js';
import { shortDay } from '../safespend.js';
import { checkinData, markDone } from '../checkin.js';
import * as ToCheck from './tocheck.js';

const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;

export function open() {
  const { state } = ctx;
  const today = todayISO();
  const d = checkinData(state, today);
  const r = d.review;
  const cur = state.settings.currency || 'MDL';
  const f = (c) => esc(formatMoney(Math.round(c / 100) * 100, cur));
  const cats = state.settings.categories.filter((c) => !c.archived && c.type === 'expense' && c.id !== 'other');
  const step = (n, title, body, done) => `<section class="ci-step${done ? ' done' : ''}"><div class="ci-n">${done ? '✓' : n}</div><div class="ci-body"><b>${title}</b>${body}</div></section>`;
  const weekLine = !r.expense ? `<p>Nothing logged as spent in the last 7 days.${r.records ? '' : ' Anything to add? Use ＋ New record before you finish.'}</p>` : `<p>Spent <b>${f(r.expense)}</b> in the last 7 days${r.usual ? `, ${r.change > 0.05 ? `${pct(r.change)} more than` : r.change < -0.05 ? `${pct(r.change)} less than` : 'about the same as'} a usual week (${f(r.usual)})` : ''}.${d.leakName ? ` Most went to <b>${esc(d.leakName)}</b> (${f(r.leak.amount)}${r.leak.usual != null ? `, usually ${f(r.leak.usual)}` : ''}).` : ''}${r.streak >= 2 ? ` 🔥 ${r.streak}-day logging streak.` : ''}</p>`;
  const confirm = d.check.length || d.late.length
    ? `<p>${d.check.length ? `${d.check.length} payment${d.check.length === 1 ? '' : 's'} from your phone to check. ` : ''}${d.late.length ? `${d.late.length} bill${d.late.length === 1 ? '' : 's'} not marked paid (${d.late.slice(0, 3).map((x) => esc(x.rule.note || 'Bill')).join(', ')}).` : ''}</p>
      <div class="btns">${d.check.length ? '<button type="button" class="btn sm primary" data-ci="check">Check payments</button>' : ''}${d.late.length ? '<button type="button" class="btn sm" data-ci="bills">Bills to confirm</button>' : ''}</div>`
    : '<p class="muted">Nothing waiting. 👌</p>';
  const other = d.other.length
    ? `<p>Pick a category for each; the next one from the same shop gets it.</p>${d.other.map((t) => `<div class="ci-other" data-id="${esc(t.id)}"><span><b>${esc(t.note || 'No note')}</b><small class="muted">${esc(dayLabel(t.date))} · ${esc(formatMoney(t.amount, t.currency))}</small></span><select data-ci-cat aria-label="Category for ${esc(t.note || 'this record')}"><option value="">Choose…</option>${cats.map((c) => `<option value="${esc(c.id)}">${esc(`${c.emoji || ''} ${c.name}`.trim())}</option>`).join('')}</select></div>`).join('')}`
    : '<p class="muted">Every record has a category. 👌</p>';
  const next = `<p>About <b>${f(Math.max(0, d.perDay))}</b> a day is safe to spend.${d.next.length ? ` Coming: ${d.next.slice(0, 4).map((x) => `${esc(x.rule.note || 'Bill')} ${esc(formatMoney(x.rule.amount, x.rule.currency))} (${esc(shortDay(x.date))})`).join(', ')}.` : ' No bills in the next 7 days.'}</p>${d.tip ? `<p class="ci-tip">💡 <b>${esc(d.tip.title)}</b>. ${esc(d.tip.text)}</p>` : ''}`;
  if (document.querySelector('.sheet')) ctx.closeSheet();
  ctx.openSheet(`<h3>Your week · 10-minute check-in <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="ci-list" data-testid="checkin">
      ${step(1, 'Your week', weekLine, true)}
      ${step(2, 'Confirm what came in by itself', confirm, !(d.check.length || d.late.length))}
      ${step(3, 'File what is in "Other"', other, !d.other.length)}
      ${step(4, 'Next week', next, true)}
    </div>
    <div class="btns"><button type="button" class="btn" data-close>Later</button><button type="button" class="btn primary" data-ci="done" data-testid="checkin-done">Done for this week ✓</button></div>`, (sheet) => {
    sheet.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-ci-cat]');
      if (!sel || !sel.value) return;
      const id = sel.closest('.ci-other').dataset.id;
      const t = ctx.state.tx.find((x) => x.id === id);
      if (!t) return;
      t.category = sel.value;
      delete t.sub;
      M.touch(t);
      ctx.commit();
      sel.closest('.ci-other').classList.add('filed');
      ctx.toast(`Filed under ${M.category(ctx.state, sel.value)?.name || 'that'}`);
    });
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ci]');
      if (!b) return;
      if (b.dataset.ci === 'check') ToCheck.open();
      else if (b.dataset.ci === 'bills') { ctx.closeSheet(); ctx.ui.planTab = 'repeating'; location.hash = '#plan'; ctx.render(); }
      else if (b.dataset.ci === 'done') {
        markDone(ctx.state, todayISO());
        ctx.commit();
        ctx.closeSheet();
        ctx.toast('Week checked ✓ See you next Sunday');
      }
    });
  });
}
