// Plan → Budgets: weekly, yearly, tag and trip budgets (js/budgets.js) under the
// monthly category budgets. Progress bars for each, an "Add budget" sheet,
// and edit / delete. The 80% and 100% notifications come from js/budgetwarn.js.

import { ctx, esc } from '../ctx.js';
import * as B from '../budgets.js';
import { todayISO, dayLabel, addDays } from '../dates.js';
import { evalAmount, centsToPlain } from '../money.js';

const catName = (id) => ctx.state.settings.categories.find((c) => c.id === id)?.name || 'Other';

function row(p) {
  const b = p.budget;
  const w = Math.min(100, p.pct * 100).toFixed(1);
  const period = b.period === 'range' ? `${dayLabel(p.from)} to ${dayLabel(p.to)}` : B.PERIODS.find((x) => x.id === b.period)?.name || '';
  const what = [...(b.cats || []).map(catName), ...(b.tags || []).map((g) => `#${g}`)].join(', ');
  const foot = p.status === 'soon' ? `Starts ${dayLabel(p.from)}`
    : p.status === 'ended' ? `Ended · ${ctx.money(p.spent)} of ${ctx.money(b.limit, { compact: true })}`
      : p.level === 'over' ? `Over by ${ctx.money(-p.left)}` : `${ctx.money(p.left)} left${b.period === 'range' ? ` · ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} to go` : ''}`;
  return `<button class="jar budget-row" data-act="budget-kind-edit" data-id="${esc(b.id)}" data-testid="budget-kind-row">
    <span class="row"><span>${esc(b.name)} <span class="muted">${Math.round(p.pct * 100)}%</span></span><span class="money">${ctx.money(p.spent)} <span class="muted">/ ${ctx.money(b.limit, { compact: true })}</span></span></span>
    <span class="bar ${p.level === 'over' ? 'over' : p.level === 'ok' ? '' : 'gold'}"><i style="width:${w}%"></i></span>
    <span class="foot ${p.level === 'over' ? 'bad' : ''}">${esc(period)}${what ? ` · ${esc(what)}` : ''} · ${foot}</span>
  </button>`;
}

/** The card under the monthly budgets. */
export function cards() {
  const list = B.allProgress(ctx.state, todayISO());
  return `<section class="card" data-testid="budget-kinds"><h2>Week, year and trip budgets <button class="btn sm right" data-act="budget-kind-add" data-testid="budget-kind-add">+ Add budget</button></h2>
    ${list.length ? `<div>${list.map(row).join('')}</div>` : '<p class="muted" style="margin-top:0">A limit for a week, a year, a #tag, or a trip (from day to day, only some categories or tags). You get a warning at 80% and 100%, like monthly budgets.</p>'}</section>`;
}

function openSheet(existing = null) {
  const { state } = ctx;
  const today = todayISO();
  const cats = state.settings.categories.filter((c) => c.type === 'expense');
  const d = existing ? { ...existing } : { period: 'month', name: '', cats: [], tags: [], from: today, to: addDays(today, 7) };
  let limitText = existing ? centsToPlain(existing.limit) : '';
  const html = () => `<div class="grab"></div><form id="bk-form" novalidate data-testid="budget-kind-form">
    <h3>${existing ? 'Edit budget' : 'New budget'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <label class="field"><span>Name</span><input id="bk-name" type="text" value="${esc(d.name)}" placeholder="e.g. Trip to Rome, Weekly fun" maxlength="60"></label>
    <div class="row2"><label class="field"><span>Limit (${esc(state.settings.currency)})</span><input id="bk-limit" type="text" inputmode="decimal" value="${esc(limitText)}" placeholder="0" aria-label="Limit"></label>
      <label class="field"><span>Period</span><select id="bk-period">${B.PERIODS.map((p) => `<option value="${p.id}" ${p.id === d.period ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
    ${d.period === 'range' ? `<div class="row2"><label class="field"><span>From</span><input id="bk-from" type="date" value="${esc(d.from || today)}"></label><label class="field"><span>To</span><input id="bk-to" type="date" value="${esc(d.to || today)}"></label></div>` : ''}
    <div class="field"><span>Only these categories (none picked: all)</span><div class="chips" role="group" aria-label="Categories">${cats.map((c) => `<button type="button" class="chip" data-bk-cat="${esc(c.id)}" aria-pressed="${(d.cats || []).includes(c.id)}">${c.emoji ? `${esc(c.emoji)} ` : ''}${esc(c.name)}</button>`).join('')}</div></div>
    <label class="field"><span>Only these #tags (spaces between, optional)</span><input id="bk-tags" type="text" value="${esc((d.tags || []).map((g) => `#${g}`).join(' '))}" placeholder="#rome #trip"></label>
    <p class="lock-msg" id="bk-msg" role="alert"></p>
    <div class="btns">${existing ? '<button type="button" class="btn danger" data-act="budget-kind-delete">Delete</button>' : ''}<button type="submit" class="btn primary">${existing ? 'Save' : 'Add budget'}</button></div>
  </form>`;
  const read = (sheet) => {
    const v = (id) => sheet.querySelector(id);
    d.name = v('#bk-name').value;
    limitText = v('#bk-limit').value;
    d.period = v('#bk-period').value;
    if (v('#bk-from')) { d.from = v('#bk-from').value; d.to = v('#bk-to').value; }
    d.tags = v('#bk-tags').value.split(/[\s,]+/).filter(Boolean);
  };
  ctx.openSheet('', (sheet) => {
    const paint = () => { sheet.innerHTML = html(); };
    paint();
    sheet.addEventListener('change', (e) => { if (e.target.id === 'bk-period') { read(sheet); paint(); } });
    sheet.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-bk-cat]');
      if (chip) {
        read(sheet);
        const id = chip.dataset.bkCat;
        d.cats = (d.cats || []).includes(id) ? d.cats.filter((x) => x !== id) : [...(d.cats || []), id];
        paint();
        return;
      }
      if (e.target.closest('[data-act="budget-kind-delete"]') && existing) {
        B.removeBudget(ctx.state, existing.id);
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${existing.name} budget removed`);
      }
    });
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      read(sheet);
      const limit = evalAmount(limitText);
      const r = B.makeBudget({ ...d, limit }, { id: existing?.id });
      if (r.error) { sheet.querySelector('#bk-msg').textContent = r.error; return; }
      B.saveBudget(ctx.state, r.budget);
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(existing ? 'Budget saved' : `${r.budget.name} budget added`);
    });
  });
}

export function onClick(act, el) {
  if (act === 'budget-kind-add') { openSheet(); return true; }
  if (act === 'budget-kind-edit') {
    const b = B.budgetsOf(ctx.state).find((x) => x.id === el.dataset.id);
    if (b) openSheet(b);
    return true;
  }
  return false;
}
