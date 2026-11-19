// Money batch 2 screens: budgets from your last 3 months, the month review
// card on Home (1st to 7th), the net worth line on Home and the Subscriptions
// list with their yearly cost (a tab on Plan). Numbers come from
// js/budgetsuggest.js, js/monthreview.js and js/subslist.js (pure, tested).
// Every write goes through ctx.commit, so it is one Undo step.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { todayISO, dayLabel, monthLabel } from '../dates.js';
import { evalAmount, formatMoney, centsToPlain } from '../money.js';
import { lineChart } from '../charts.js';
import { suggestBudgets } from '../budgetsuggest.js';
import { monthReview, dismissedReviews, dismissReview, netWorthLine } from '../monthreview.js';
import { subscriptionRows, setSubAnswer } from '../subslist.js';
import * as Tips from '../tips.js';

const cur = () => ctx.state.settings.currency;
const shortDay = (iso) => dayLabel(iso).replace(/^\w+, /, '');
const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;

// ---------- 1. Suggest budgets ----------

export function suggestButton() {
  return '<button type="button" class="btn" data-act="b2-suggest" data-testid="b2-suggest-btn">Suggest budgets from the last 3 months</button>';
}

function openSuggest() {
  const st = ctx.state;
  const rows = suggestBudgets(st, todayISO());
  if (!rows.length) { ctx.toast('No spending in the last 3 full months to base budgets on'); return; }
  ctx.openSheet(`<h3>Budgets from the last 3 months <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="b2-form" novalidate data-testid="b2-form">
      <p class="muted small" style="margin-top:0">The monthly average of the last 3 full months, rounded up to the nearest 50 ${esc(cur())}. One-off records and work costs are left out. Edit any amount, untick what you do not want. Only ticked ones are saved, and one Undo puts the old budgets back.</p>
      <div class="budget-list">${rows.map((r) => `<label class="budget-edit b2-row">
        <span class="n"><input type="checkbox" data-b2-tick="${esc(r.id)}" checked aria-label="Use ${esc(r.name)}"> ${r.emoji ? `<span class="ci">${esc(r.emoji)}</span>` : ''}${esc(r.name)}</span>
        <span class="muted small">${r.current ? `now ${esc(formatMoney(r.current, cur(), { compact: true }))}` : 'no budget'} · avg ${esc(formatMoney(r.average, cur(), { compact: true }))}</span>
        <input type="text" inputmode="decimal" data-b2-val="${esc(r.id)}" value="${esc(centsToPlain(r.suggested))}" aria-label="Budget for ${esc(r.name)}">
      </label>`).join('')}</div>
      <div class="btns" style="margin-top:14px"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" data-testid="b2-save">Save</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#b2-form').addEventListener('submit', (e) => {
      e.preventDefault();
      let n = 0;
      for (const tick of sheet.querySelectorAll('[data-b2-tick]')) {
        if (!tick.checked) continue;
        const id = tick.dataset.b2Tick;
        const v = evalAmount(sheet.querySelector(`[data-b2-val="${CSS.escape(id)}"]`).value) || 0;
        const c = M.category(st, id);
        if (!c || !(v > 0)) continue;
        if (c.budget !== v) { c.budget = v; M.touch(c); }
        n++;
      }
      if (!n) { ctx.closeSheet(); ctx.toast('Nothing ticked: no budget changed'); return; }
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`${n} budget${n === 1 ? '' : 's'} saved`, 'Undo', () => ctx.undo());
    });
  });
}

// ---------- 2. Month review ----------

export function reviewCard(today = todayISO()) {
  const st = ctx.state;
  if (!st || st._sealed) return '';
  const r = monthReview(st, today);
  if (!r || dismissedReviews().includes(r.key)) return '';
  const f = (c) => formatMoney(c, cur());
  const vs = r.change == null ? 'no month before to compare' : `${r.change > 0 ? '↑' : r.change < 0 ? '↓' : '='} ${pct(r.change)} vs the month before`;
  const top = r.top ? `${esc(r.top.name)} ${r.top.diff > 0 ? 'up' : 'down'} ${esc(f(Math.abs(r.top.diff)))}` : 'No category changed';
  const rate = r.rate == null ? 'No income logged' : `${Math.round(r.rate * 100)}%`;
  const over = r.over.length ? r.over.map((o) => `${esc(o.name)} (${o.pct}% over)`).join(', ') : 'None';
  return `<section class="card b2-review" data-testid="b2-review">
    <h2>${esc(r.name)} review <button class="card-link right" data-act="b2-review-dismiss" data-key="${esc(r.key)}" data-testid="b2-review-dismiss">Dismiss</button></h2>
    <dl class="b2-facts">
      <div><dt>Spent</dt><dd data-testid="b2-spent"><b>${esc(f(r.spent))}</b> <small>${esc(vs)}</small></dd></div>
      <div><dt>Biggest change</dt><dd>${top}</dd></div>
      <div><dt>Savings rate</dt><dd data-testid="b2-rate">${rate}</dd></div>
      <div><dt>Budgets over</dt><dd>${over}</dd></div>
      ${r.sources?.length ? `<div><dt>Income by source</dt><dd data-testid="b2-sources">${r.sources.map((x) => `${esc(x.name)} ${esc(f(x.amount))}`).join(' · ')}</dd></div>` : ''}
    </dl>
    <p class="b2-tip">${esc(r.tip.text)}</p>
    <div class="btns"><button type="button" class="btn small" data-act="recap-open" data-key="${esc(r.key)}">Open full recap</button></div>
  </section>`;
}

// ---------- 3. Net worth line ----------

export function netWorthCard(today = todayISO()) {
  const st = ctx.state;
  if (!st || st._sealed) return '';
  const nw = netWorthLine(st, today);
  if (!nw) return '';
  const f = (c) => formatMoney(c, cur());
  const points = nw.points.map((p, i) => ({ value: p.value, date: p.date, label: i === nw.points.length - 1 ? 'Today' : monthLabel(p.key, true).slice(0, 3) }));
  const up = nw.change >= 0;
  const since = nw.twelve ? '12 months ago' : shortDay(nw.since);
  return `<section class="card b2-nw" data-testid="b2-networth" data-go="longview" role="link" tabindex="0" title="Open the long view">
    <h2>Net worth <span class="muted small">month ends, last 12 months</span></h2>
    <div class="b2-nw-top"><b class="money" data-testid="b2-nw-now">${esc(f(nw.now))}</b>
      <span class="${up ? 'income' : 'expense'}" data-testid="b2-nw-change">${up ? '+' : '−'}${esc(f(Math.abs(nw.change)))}${nw.percent == null ? '' : ` (${up ? '+' : '−'}${pct(nw.percent)})`} <small class="muted">vs ${esc(since)}</small></span></div>
    ${lineChart(points, (v) => f(v), { label: 'Net worth at each month end' })}
  </section>`;
}

// ---------- 4. Subscriptions with their yearly cost ----------

export function subsTab() {
  const st = ctx.state;
  const { rows, total } = subscriptionRows(st, todayISO());
  const f = (c) => formatMoney(c, cur());
  if (!rows.length) return `<section class="card" data-testid="b2-subs"><h2>Subscriptions</h2>${Tips.EMPTY.subscriptions()}</section>`;
  const row = (x) => `<div class="tx rec-row b2-sub" data-testid="b2-sub-row" data-key="${esc(x.key)}">
    <span class="t"><b>${esc(x.name)}</b><span>${esc(x.every)} · last ${esc(formatMoney(x.amount, x.currency))}${x.next ? ` · next around ${esc(shortDay(x.next))}` : ''}</span>
      ${x.kept ? `<span class="b2-note">Kept (${esc(shortDay(x.kept))}) <button type="button" class="card-link" data-act="b2-sub" data-op="unkeep" data-key="${esc(x.key)}">Undo</button></span>` : ''}
      ${x.remind ? `<span class="b2-note" data-testid="b2-remind-note">Reminder: think about cancelling (added ${esc(shortDay(x.remind))}) <button type="button" class="card-link" data-act="b2-sub" data-op="unremind" data-key="${esc(x.key)}">Clear</button></span>` : ''}</span>
    <span class="sub-year"><b class="money" data-testid="b2-year">${esc(f(x.yearly))}</b><small class="muted">per year</small></span>
    <span class="sub-acts"><span class="muted small">Still using it?</span>
      <button type="button" class="btn small" data-act="b2-sub" data-op="keep" data-key="${esc(x.key)}">Keep</button>
      <button type="button" class="btn small" data-act="b2-sub" data-op="remind" data-key="${esc(x.key)}">Remind me to cancel</button></span>
  </div>`;
  return `<section class="card" data-testid="b2-subs"><h2>Subscriptions <span class="right" data-testid="b2-subs-total"><b class="money">${esc(f(total))}</b> <small class="muted">per year</small></span></h2>
    <p class="muted small" style="margin-top:0">Payments that come back regularly, with what each costs a year. Nothing here is cancelled or deleted: Keep or a reminder only leaves a note.</p>
    <div class="list">${rows.map(row).join('')}</div></section>`;
}

// ---------- clicks ----------

export function onClick(act, el) {
  if (act === 'b2-suggest') { openSuggest(); return true; }
  if (act === 'b2-review-dismiss') { dismissReview(el.dataset.key); ctx.render(); return true; }
  if (act === 'b2-sub') {
    const op = el.dataset.op;
    if (setSubAnswer(ctx.state, el.dataset.key, op, todayISO())) {
      ctx.commit();
      ctx.toast(op === 'keep' ? 'Kept. Nothing was changed.' : op === 'remind' ? 'Reminder added to the list.' : 'Cleared.', 'Undo', () => ctx.undo());
    }
    return true;
  }
  return false;
}
