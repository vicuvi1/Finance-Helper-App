// Plan: recurring payments and income (rent, subscriptions, salary, client
// retainers). Shows what is due now, what is coming in the next 30 days and
// what your regular costs add up to; logs them with one tap or by itself.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as R from '../recurring.js';
import { todayISO, dayLabel, daysBetween, addDays, monthKey, monthLabel, daysInMonth } from '../dates.js';
import { evalAmount, formatMoney, centsToPlain } from '../money.js';
import { convert } from '../fx.js';
import { forecast } from '../forecast.js';
import { lineChart } from '../charts.js';

const initial = (name) => esc((String(name).match(/\p{L}|\p{N}/u) || ['•'])[0].toUpperCase());
const catOf = (id) => M.category(ctx.state, id) || { name: 'Other', emoji: '•' };
const titleOf = (r) => r.note || catOf(r.category).name;
const freq = (r) => R.FREQS.find((f) => f.id === r.every) || R.FREQS[2];
const base = () => ctx.state.settings.currency;
const inBase = (r, cents = r.amount) => (r.currency === base() ? cents : convert(cents, r.currency, base(), ctx.state.rates));
const sum = (items) => items.reduce((a, x) => a + (inBase(x.rule) || 0), 0);
const when = (date, today) => {
  const d = daysBetween(today, date);
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : `in ${d} days`;
};
const ruleMoney = (r) => (r.type === 'income' ? formatMoney(r.amount, r.currency, { sign: true }) : formatMoney(-r.amount, r.currency));
const txId = (rule, date) => `rec-${rule.id}-${date}`;

function itemRow(it, today, { due = false } = {}) {
  const r = it.rule;
  return `<div class="tx rec-row">
    <span class="av" style="--c:${ctx.catColor(r.category)}" aria-hidden="true">${initial(catOf(r.category).name)}</span>
    <button class="t rec-open" data-act="rec-log-edit" data-id="${esc(r.id)}" data-date="${it.date}"><b>${esc(titleOf(r))}${due ? ' <span class="pill pill-out">due</span>' : ''}</b><span>${esc(dayLabel(it.date))} · ${when(it.date, today)} · ${esc(M.account(ctx.state, r.account)?.name || '')}</span></button>
    <span class="amount ${r.type === 'income' ? 'income' : ''}">${ruleMoney(r)}</span>
    ${due ? `<span class="rec-btns"><button class="btn primary sm" data-act="rec-log" data-id="${esc(r.id)}" data-date="${it.date}">${r.type === 'income' ? 'Got it' : 'Paid'}</button><button class="btn sm" data-act="rec-skip" data-id="${esc(r.id)}" data-date="${it.date}">Skip</button></span>` : ''}
  </div>`;
}

function ruleRow(r, today) {
  const dueNow = R.dueItems({ recurring: [r] }, today)[0]?.date;
  const next = R.nextDate(r, r.lastDone && r.lastDone >= today ? r.lastDone : addDays(today, -1));
  const nextLabel = r.paused ? 'paused' : dueNow ? `due ${dayLabel(dueNow)}` : next ? `next ${dayLabel(next)}` : 'ended';
  return `<button class="tx" data-act="rec-edit" data-id="${esc(r.id)}">
    <span class="av" style="--c:${ctx.catColor(r.category)}" aria-hidden="true">${initial(catOf(r.category).name)}</span>
    <span class="t"><b>${esc(titleOf(r))}${r.auto ? ' <span class="pill pill-gold">auto</span>' : ''}</b><span>${esc(freq(r).label)} · ${esc(nextLabel)}</span></span>
    <span class="amount ${r.type === 'income' ? 'income' : ''} ${r.paused ? 'muted' : ''}">${ruleMoney(r)}</span>
  </button>`;
}

export function view() {
  const { state } = ctx;
  const today = todayISO();
  const due = R.dueItems(state, today);
  const up = R.upcomingItems(state, today, 30);
  const rules = [...(state.recurring || [])].sort((a, b) => Number(a.paused) - Number(b.paused) || a.type.localeCompare(b.type) || b.amount - a.amount);
  const act = rules.filter((r) => !r.paused);
  const monthlyOut = act.filter((r) => r.type === 'expense').reduce((a, r) => a + (inBase(r, R.perMonth(r)) || 0), 0);
  const monthlyIn = act.filter((r) => r.type === 'income').reduce((a, r) => a + (inBase(r, R.perMonth(r)) || 0), 0);
  const outSoon = sum([...due, ...up].filter((x) => x.rule.type === 'expense'));
  const inSoon = sum([...due, ...up].filter((x) => x.rule.type === 'income'));
  const sugg = R.suggestions(state, today).slice(0, 5);

  return `<header class="top"><div><h1>Plan</h1><div class="sub">Budgets, bills, subscriptions and regular income</div></div>
    <button class="btn primary" data-act="rec-new">+ Add recurring</button></header>
  <section class="hero">
    <div class="hero-main">
      <div class="label">To pay in the next 30 days</div>
      <div class="big">${ctx.bigMoney(outSoon)}</div>
      <p class="muted" style="margin:0">${inSoon ? `${ctx.money(inSoon)} expected to come in.` : 'No regular income planned yet.'}${due.length ? ` <b class="expense">${due.length} due now.</b>` : ''}</p>
    </div>
    <div class="hero-month">
      <div class="label">Every month, on average</div>
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="stat"><span class="k">Regular costs</span><b class="expense">${ctx.countUp(monthlyOut, 'rec-out')}</b></div>
        <div class="stat"><span class="k">Regular income</span><b class="income">${ctx.countUp(monthlyIn, 'rec-in')}</b></div>
      </div>
    </div>
  </section>
  <div class="dash">
    <div class="dash-main">
      ${forecastCard()}
      ${due.length ? `<section class="card"><h2>Due now <span class="right muted">${due.length}</span></h2><div class="list">${due.map((x) => itemRow(x, today, { due: true })).join('')}</div>
        <p class="muted small" style="margin-bottom:0">"Paid" logs the planned amount on its date. Tap the name to change the amount first.</p></section>` : ''}
      <section class="card"><h2>Coming up · 30 days</h2>
        ${up.length ? `<div class="list">${up.map((x) => itemRow(x, today)).join('')}</div>` : '<p class="muted" style="margin:0">Nothing planned in the next 30 days.</p>'}</section>
    </div>
    <div class="dash-side">
      ${budgetCard()}
      <section class="card"><h2>Your recurring <span class="right muted">${rules.length}</span></h2>
        ${rules.length ? `<div class="list">${rules.map((r) => ruleRow(r, today)).join('')}</div>` : '<p class="muted" style="margin-top:0">Add rent, phone, internet, subscriptions, salary or a client who pays every month. You can also tick "Repeat" when you log a record.</p><button class="btn primary block" data-act="rec-new">Add the first one</button>'}
      </section>
      ${sugg.length ? `<section class="card"><h2>Looks regular</h2><p class="muted small" style="margin-top:0">These show up every month in your log.</p>
        <div class="list">${sugg.map((s) => `<div class="tx rec-row"><span class="av" style="--c:${ctx.catColor(s.tx.category)}" aria-hidden="true">${initial(catOf(s.tx.category).name)}</span>
          <span class="t"><b>${esc(s.tx.note)}</b><span>${s.months} of the last 4 months · ${formatMoney(s.tx.amount, s.tx.currency || base())}</span></span>
          <button class="btn sm" data-act="rec-from" data-id="${esc(s.tx.id)}">Make recurring</button></div>`).join('')}</div></section>` : ''}
    </div>
  </div>`;
}

// ---------- Cash-flow forecast ----------

const shortDay = (iso) => dayLabel(iso).replace(/^\w+, /, '');

function forecastCard() {
  const days = ctx.ui.fcDays || 60;
  const f = forecast(ctx.state, todayISO(), { days });
  const lei = (c) => Math.round(c / 100) * 100;
  const chip = (n) => `<button class="chip" aria-pressed="${days === n}" data-act="fc-days" data-n="${n}">${n} days</button>`;
  const short = f.low.value < 0;
  const next = f.events.slice(0, 6);
  return `<section class="card"><h2>Cash-flow forecast <span class="right">${chip(30)}${chip(60)}${chip(90)}</span></h2>
    <div class="fc-stats">
      <div><span class="k">Spending money now</span><b>${ctx.money(lei(f.start))}</b></div>
      <div><span class="k">In ${days} days</span><b class="${f.end < 0 ? 'expense' : ''}">${ctx.money(lei(f.end))}</b></div>
      <div><span class="k">Lowest</span><b class="${short ? 'expense' : ''}">${ctx.money(lei(f.low.value))}</b><span class="muted small">${esc(shortDay(f.low.date))}</span></div>
    </div>
    ${short ? `<p class="fc-warn">Money runs short around <b>${esc(dayLabel(f.low.date))}</b>. Move some from savings before then, or plan smaller spending.</p>` : ''}
    ${lineChart(f.points.map((p) => ({ label: shortDay(p.date), value: lei(p.value) })), (c) => ctx.money(c), { color: short ? 'var(--expense)' : 'var(--gold)' })}
    ${next.length ? `<div class="fc-events">${next.map((e) => `<div class="kv"><span>${esc(shortDay(e.date))} · ${esc(e.label)}${e.late ? ' <span class="pill pill-out">late</span>' : ''}</span><b class="${e.amount > 0 ? 'income' : ''}">${ctx.money(lei(e.amount), { sign: true })}</b></div>`).join('')}</div>` : ''}
    <p class="muted small" style="margin-bottom:0">Cards and cash only (not savings or crypto). Counts your recurring bills and income, unpaid invoices, and about ${ctx.money(lei(f.daily))} a day of everyday spending (your last 90 days).</p>
  </section>`;
}

// ---------- Budgets ----------

function budgetCard() {
  const today = todayISO();
  const key = monthKey(today);
  const st = M.budgetStatus(ctx.state, key, today);
  if (!st.rows.length) {
    return `<section class="card"><h2>Budgets</h2>
      <p class="muted" style="margin-top:0">Give the categories you want to keep in check (food, going out, clothes…) a monthly limit. You get a warning at 80%, when you go over, and when your pace would take you over.</p>
      <button class="btn primary block" data-act="budget-set">Set budgets</button></section>`;
  }
  const evenPace = (Number(today.slice(8, 10)) / daysInMonth(key)) * 100;
  const rows = st.rows.map((r) => {
    const c = r.category;
    const w = Math.min(100, r.pct * 100).toFixed(1);
    const foot = r.level === 'over' ? `Over by ${ctx.money(-r.left)}` : r.level === 'pace' ? `${ctx.money(r.left)} left · on pace for ${ctx.money(r.projected)}` : `${ctx.money(r.left)} left`;
    return `<button class="jar budget-row" data-act="cat-open" data-cat="${esc(c.id)}" data-period="month" data-type="expense">
      <span class="row"><span>${ctx.dot(ctx.catColor(c.id))}${esc(c.name)} <span class="muted">${Math.round(r.pct * 100)}%</span></span><span class="money">${ctx.money(r.spent)} <span class="muted">/ ${ctx.money(r.budget, { compact: true })}</span></span></span>
      <span class="bar ${r.level === 'over' ? 'over' : r.level === 'ok' ? '' : 'gold'}"><i style="width:${w}%"></i><span class="mark" style="left:${evenPace.toFixed(1)}%" title="Where an even pace would be today"></span></span>
      <span class="foot ${r.level === 'over' ? 'bad' : ''}">${foot}</span>
    </button>`;
  }).join('');
  return `<section class="card"><h2>Budgets · ${esc(monthLabel(key))} <button class="card-link right" data-act="budget-set">Edit</button></h2>
    <p class="muted small" style="margin-top:0">${ctx.money(st.spent)} of ${ctx.money(st.budget)} · ${st.left >= 0 ? `${ctx.money(st.left)} left` : `<b class="expense">${ctx.money(-st.left)} over</b>`} · ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} to go. The line marks an even pace.</p>
    ${rows}</section>`;
}

function budgetSheet() {
  const { state } = ctx;
  const key = monthKey(todayISO());
  const cats = state.settings.categories.filter((c) => c.type === 'expense');
  const avg = Object.fromEntries(cats.map((c) => [c.id, M.averageSpend(state, c.id, key, 3)]));
  const round50 = (x) => Math.ceil(x / 5000) * 5000;
  ctx.openSheet(`<h3>Monthly budgets <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="budget-form" novalidate>
      <p class="muted small" style="margin-top:0">Leave empty for no limit. Amounts in ${esc(base())} per month; "avg" is what you spent on average in the last 3 months (tap it to use it).</p>
      <div class="budget-list">${cats.map((c) => `<label class="budget-edit">
        <span class="n">${ctx.dot(ctx.catColor(c.id))}${esc(c.name)}</span>
        ${avg[c.id] ? `<button type="button" class="card-link" data-fill="${esc(c.id)}" data-v="${round50(avg[c.id])}">avg ${ctx.money(avg[c.id], { compact: true })}</button>` : '<span></span>'}
        <input type="text" inputmode="decimal" id="b-${esc(c.id)}" value="${c.budget ? esc(centsToPlain(c.budget)) : ''}" placeholder="no limit" aria-label="Budget for ${esc(c.name)}">
      </label>`).join('')}</div>
      <div class="btns" style="margin-top:14px"><button type="button" class="btn" data-fill-all>Use my averages for empty ones</button><button type="submit" class="btn primary">Save budgets</button></div>
    </form>`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const one = e.target.closest('[data-fill]');
      if (one) { sheet.querySelector(`#b-${CSS.escape(one.dataset.fill)}`).value = centsToPlain(Number(one.dataset.v)); return; }
      if (e.target.closest('[data-fill-all]')) {
        for (const b of sheet.querySelectorAll('[data-fill]')) {
          const input = sheet.querySelector(`#b-${CSS.escape(b.dataset.fill)}`);
          if (!input.value.trim()) input.value = centsToPlain(Number(b.dataset.v));
        }
      }
    });
    sheet.querySelector('#budget-form').addEventListener('submit', (e) => {
      e.preventDefault();
      let n = 0;
      for (const c of cats) {
        const v = evalAmount(sheet.querySelector(`#b-${CSS.escape(c.id)}`).value) || 0;
        const next = v > 0 ? v : null;
        if ((c.budget || null) !== next) { c.budget = next; M.touch(c); }
        if (next) n++;
      }
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(n ? `${n} budget${n === 1 ? '' : 's'} set` : 'No budgets set');
    });
  });
}

// Small "Coming up" card for the dashboard.
export function homeCard() {
  const { state } = ctx;
  if (!(state.recurring || []).length) return '';
  const today = todayISO();
  const due = R.dueItems(state, today);
  const up = R.upcomingItems(state, today, 14).slice(0, Math.max(0, 4 - due.length));
  if (!due.length && !up.length) return '';
  return `<section class="card"><h2>Coming up <button class="card-link right" data-go="plan">Plan</button></h2>
    <div class="list">${due.slice(0, 4).map((x) => itemRow(x, today, { due: true })).join('')}${up.map((x) => itemRow(x, today)).join('')}</div>
    ${due.length > 4 ? `<p class="muted small" style="margin-bottom:0">${due.length - 4} more due on the Plan screen.</p>` : ''}</section>`;
}

// ---------- Logging ----------

function logNow(rule, date) {
  const { state } = ctx;
  const rate = rule.currency === base() ? 1 : ctx.suggestedRate(rule.currency);
  if (!rate) { logWithSheet(rule, date); return; }
  const id = txId(rule, date);
  if (!state.tx.some((t) => t.id === id)) {
    state.tx.push(R.makeTx(rule, date, { id, rate }));
    delete state.deleted[id];
  }
  R.markDone(rule, date);
  ctx.ui.flashId = id;
  ctx.commit();
  ctx.toast(`Logged ${titleOf(rule)} ${ruleMoney(rule)}`);
}

function logWithSheet(rule, date) {
  ctx.openTxSheet(null, {
    type: rule.type,
    amountText: centsToPlain(rule.amount),
    note: rule.note,
    category: rule.category,
    account: rule.account,
    date,
    personName: M.person(ctx.state, rule.person)?.name || '',
    fromRule: { id: rule.id, date, txId: txId(rule, date) },
  });
}

function skip(rule, date) {
  R.markDone(rule, date);
  ctx.commit();
  ctx.toast(`Skipped ${titleOf(rule)} on ${dayLabel(date)}`);
}

// Rules set to "log by itself": add every due date (same record id on every
// device, so syncing two devices never doubles it).
export function runAuto() {
  const { state } = ctx;
  if (ctx.DEMO || state._sealed) return 0;
  let n = 0;
  for (const { rule, date } of R.dueItems(state, todayISO())) {
    if (!rule.auto) continue;
    const rate = rule.currency === base() ? 1 : ctx.suggestedRate(rule.currency);
    if (!rate) continue;
    const id = txId(rule, date);
    if (!state.tx.some((t) => t.id === id) && !state.deleted[id]) { state.tx.push(R.makeTx(rule, date, { id, rate })); n++; }
    R.markDone(rule, date);
  }
  if (n) {
    ctx.commit();
    ctx.toast(`Added ${n} recurring record${n === 1 ? '' : 's'}`);
  }
  return n;
}

export function initPlan() {
  setTimeout(runAuto, 1500);
  setInterval(runAuto, 60 * 60000);
}

// ---------- Add / edit ----------

export function editRule(existing = null, preset = {}) {
  const { state } = ctx;
  const accounts = M.activeAccounts(state);
  const r = existing ? { ...existing } : { type: 'expense', every: 'month', start: todayISO(), account: accounts[0]?.id, category: null, note: '', auto: false, amount: 0, ...preset };
  let amountText = r.amount ? centsToPlain(r.amount) : '';

  const html = () => {
    const cats = state.settings.categories.filter((c) => c.type === r.type);
    if (!cats.some((c) => c.id === r.category)) r.category = cats.find((c) => c.id === (r.type === 'income' ? 'work' : 'home'))?.id || cats[0]?.id;
    const cur = M.account(state, r.account)?.currency || base();
    return `<div class="grab"></div><form id="rec-form" novalidate>
      <h3>${existing ? 'Edit recurring' : 'New recurring'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <div class="seg two" role="group" aria-label="Type"><button type="button" data-type="expense" aria-pressed="${r.type === 'expense'}">I pay</button><button type="button" data-type="income" aria-pressed="${r.type === 'income'}">I get paid</button></div>
      <div class="amount-input"><input id="rec-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amountText)}" aria-label="Amount"><span class="cur">${esc(cur)}</span></div>
      <label class="field"><span>Name</span><input id="rec-note" type="text" value="${esc(r.note)}" placeholder="${r.type === 'income' ? 'e.g. salary, US client retainer' : 'e.g. rent, internet, Netflix'}"></label>
      <div class="row2">
        <label class="field"><span>Category</span><select id="rec-cat">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === r.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>${r.type === 'income' ? 'Into' : 'Paid from'}</span><select id="rec-acc">${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === r.account ? 'selected' : ''}>${esc(a.name)} · ${esc(a.currency)}</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label class="field"><span>How often</span><select id="rec-every">${R.FREQS.map((f) => `<option value="${f.id}" ${f.id === r.every ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
        <label class="field"><span>${existing ? 'Counting from' : 'Next (or first) date'}</span><input id="rec-start" type="date" value="${esc(r.start)}"></label>
      </div>
      <label class="field"><span>Ends (optional)</span><input id="rec-end" type="date" value="${esc(r.end || '')}"></label>
      <label class="field check"><input type="checkbox" id="rec-auto" ${r.auto ? 'checked' : ''}><span>Log it by itself on the day (for fixed amounts)</span></label>
      ${existing ? `<label class="field check"><input type="checkbox" id="rec-paused" ${r.paused ? 'checked' : ''}><span>Paused</span></label>` : ''}
      <p class="lock-msg" id="rec-msg" role="alert"></p>
      <div class="btns">${existing ? '<button type="button" class="btn danger" data-act="rec-delete">Delete</button>' : ''}<button type="submit" class="btn primary">${existing ? 'Save' : 'Add'}</button></div>
    </form>`;
  };

  const read = (sheet) => {
    const v = (id) => sheet.querySelector(id);
    amountText = v('#rec-amount').value;
    r.note = v('#rec-note').value;
    r.category = v('#rec-cat').value;
    r.account = v('#rec-acc').value;
    r.every = v('#rec-every').value;
    r.start = v('#rec-start').value || r.start;
    r.end = v('#rec-end').value || null;
    r.auto = v('#rec-auto').checked;
    if (v('#rec-paused')) r.paused = v('#rec-paused').checked;
  };

  ctx.openSheet('', (sheet) => {
    const paint = () => { sheet.innerHTML = html(); };
    paint();
    if (!existing) sheet.querySelector('#rec-amount').focus();
    sheet.addEventListener('change', (e) => { if (e.target.id === 'rec-acc') { read(sheet); paint(); } });
    sheet.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg button');
      if (seg && seg.dataset.type !== r.type) { read(sheet); r.type = seg.dataset.type; paint(); return; }
      if (e.target.closest('[data-act="rec-delete"]')) {
        state.recurring = state.recurring.filter((x) => x.id !== existing.id);
        state.deleted[existing.id] = Date.now();
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${titleOf(existing)} removed. Records already logged stay.`);
      }
    });
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      read(sheet);
      const msg = sheet.querySelector('#rec-msg');
      const amount = evalAmount(amountText);
      if (!amount || amount <= 0) { msg.textContent = 'Enter an amount bigger than 0.'; return; }
      if (r.end && r.end < r.start) { msg.textContent = 'The end date is before the first date.'; return; }
      const now = Date.now();
      const rule = { ...r, amount, note: r.note.trim(), currency: M.account(state, r.account)?.currency || base(), updatedAt: now };
      if (existing) {
        // A new start date restarts the count from there.
        if (rule.start !== existing.start || rule.every !== existing.every) rule.lastDone = null;
        state.recurring = state.recurring.map((x) => (x.id === existing.id ? rule : x));
      } else {
        rule.id = M.uid();
        rule.createdAt = now;
        rule.lastDone = rule.lastDone || null;
        state.recurring.push(rule);
      }
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(existing ? 'Saved' : `${titleOf(rule)} added: ${freq(rule).short}`);
      runAuto();
    });
  });
}

const findRule = (id) => (ctx.state.recurring || []).find((r) => r.id === id);

export function onClick(act, el) {
  if (act === 'budget-set') { budgetSheet(); return true; }
  if (act === 'fc-days') { ctx.ui.fcDays = Number(el.dataset.n); ctx.render(); return true; }
  if (act === 'rec-new') { editRule(); return true; }
  if (act === 'rec-edit') { const r = findRule(el.dataset.id); if (r) editRule(r); return true; }
  if (act === 'rec-log') { const r = findRule(el.dataset.id); if (r) logNow(r, el.dataset.date); return true; }
  if (act === 'rec-log-edit') { const r = findRule(el.dataset.id); if (r) logWithSheet(r, el.dataset.date); return true; }
  if (act === 'rec-skip') { const r = findRule(el.dataset.id); if (r) skip(r, el.dataset.date); return true; }
  if (act === 'rec-from') {
    const t = ctx.state.tx.find((x) => x.id === el.dataset.id);
    if (t) editRule(null, { type: t.type, amount: t.amount, note: t.note, category: t.category, account: t.account, person: t.person, start: R.nextDate({ every: 'month', start: t.date }, todayISO()) || todayISO(), lastDone: null });
    return true;
  }
  return false;
}
