// Clients: invoices for your work (US clients in USD or any currency),
// draft -> sent -> paid, with the payment logged as income into the account
// it arrived in. Per client: what they paid this year, per month, and what
// an hour of your work really earned (after the bank's rate).

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as I from '../invoices.js';
import { todayISO, dayLabel } from '../dates.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { FIAT, convert } from '../fx.js';

const STATUS = { draft: ['Draft', ''], sent: ['Sent', 'pill-gold'], overdue: ['Overdue', 'pill-out'], paid: ['Paid', 'pill-in'] };
const pill = (st) => `<span class="pill ${STATUS[st][1]}">${STATUS[st][0]}</span>`;
const base = () => ctx.state.settings.currency;
const inBase = (cents, cur) => (cur === base() ? cents : convert(cents, cur, base(), ctx.state.rates));
const initial = (name) => esc((String(name).match(/\p{L}|\p{N}/u) || ['•'])[0].toUpperCase());
const clientName = (id) => M.person(ctx.state, id)?.name || 'No client';
const hoursText = (h) => (Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, '').replace('.', ','));

function invRow(inv, today) {
  const st = I.invoiceStatus(inv, today);
  const when = st === 'paid' ? `paid ${dayLabel(inv.paidDate)}` : st === 'draft' ? `dated ${dayLabel(inv.date)}` : `due ${dayLabel(inv.due)}`;
  return `<button class="tx" data-act="inv-open" data-id="${esc(inv.id)}">
    <span class="av" style="--c:var(--gold)" aria-hidden="true">${initial(clientName(inv.client))}</span>
    <span class="t"><b>${esc(inv.number)} · ${esc(clientName(inv.client))} ${pill(st)}</b><span>${esc(when)}${inv.items?.[0]?.desc ? ` · ${esc(inv.items[0].desc)}` : ''}</span></span>
    <span class="amount ${st === 'paid' ? 'income' : ''}">${formatMoney(I.invoiceTotal(inv), inv.currency)}</span>
  </button>`;
}

export function view() {
  const { state } = ctx;
  const today = todayISO();
  const stats = I.clientStats(state, today);
  const invs = [...(state.invoices || [])];
  const order = { overdue: 0, sent: 1, draft: 2, paid: 3 };
  invs.sort((a, b) => order[I.invoiceStatus(a, today)] - order[I.invoiceStatus(b, today)] || b.date.localeCompare(a.date));
  const open = invs.filter((i) => ['sent', 'overdue'].includes(I.invoiceStatus(i, today)));
  const openBase = open.reduce((a, i) => a + (inBase(I.invoiceTotal(i), i.currency) || 0), 0);
  const overdue = open.filter((i) => I.invoiceStatus(i, today) === 'overdue').length;
  const paidYear = stats.reduce((a, s) => a + s.paidYear, 0);
  const hours = stats.reduce((a, s) => a + s.hours, 0);
  const perHour = hours ? Math.round(stats.reduce((a, s) => a + (s.perHour || 0) * s.hours, 0) / hours) : null;
  const shown = invs.filter((i) => I.invoiceStatus(i, today) !== 'paid').concat(invs.filter((i) => I.invoiceStatus(i, today) === 'paid').slice(0, 12));

  return `<header class="top"><div><h1>Clients & invoices</h1><div class="sub">Invoices, who pays what, and what an hour earns</div></div>
    <div class="top-actions"><button class="btn" data-act="client-new">+ Client</button><button class="btn primary" data-act="inv-new">+ Invoice</button></div></header>
  <section class="hero">
    <div class="hero-main">
      <div class="label">Waiting to be paid</div>
      <div class="big">${ctx.bigMoney(openBase)}</div>
      <p class="muted" style="margin:0">${open.length ? `${open.length} invoice${open.length === 1 ? '' : 's'} sent${overdue ? `, <b class="expense">${overdue} overdue</b>` : ''}.` : 'Nothing outstanding.'}</p>
    </div>
    <div class="hero-month">
      <div class="label">${today.slice(0, 4)} from clients</div>
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="stat"><span class="k">Paid to you</span><b class="income">${ctx.countUp(paidYear, 'cl-year')}</b></div>
        <div class="stat"><span class="k">An hour earns</span><b>${perHour ? ctx.money(perHour) : '–'}</b></div>
      </div>
    </div>
  </section>
  <div class="dash">
    <div class="dash-main">
      <section class="card"><h2>Invoices <button class="card-link right" data-act="inv-details">Your details</button></h2>
        ${shown.length ? `<div class="list">${shown.map((i) => invRow(i, today)).join('')}</div>` : `<p class="muted" style="margin-top:0">Make an invoice for a client: hours × rate or fixed amounts, in USD or any currency. Print it or save it as PDF, mark it sent, and when the money arrives mark it paid: the income is logged into the account it landed in.</p><button class="btn primary block" data-act="inv-new">Make the first invoice</button>`}
      </section>
    </div>
    <div class="dash-side">
      <section class="card"><h2>Clients <span class="right muted">${stats.length}</span></h2>
        ${stats.length ? `<div class="list">${stats.map((s, i) => `<button class="tx" data-act="client-open" data-id="${esc(s.person.id)}">
          <span class="av" style="--c:var(--c${(i % 8) + 1})" aria-hidden="true">${initial(s.person.name)}</span>
          <span class="t"><b>${esc(s.person.name)}${s.overdue ? ' <span class="pill pill-out">overdue</span>' : s.openCount ? ' <span class="pill pill-gold">open</span>' : ''}</b><span>${s.perMonth ? `${ctx.money(s.perMonth, { compact: true })}/month` : 'no payments yet'}${s.perHour ? ` · ${ctx.money(s.perHour)}/hour` : ''}${s.person.rate ? ` · rate ${formatMoney(s.person.rate, s.person.currency || 'USD')}` : ''}</span></span>
          <span class="amount income">${s.paidYear ? ctx.money(s.paidYear, { compact: true }) : ''}</span></button>`).join('')}</div>`
          : '<p class="muted" style="margin-top:0">Mark someone as a client (a company or person who pays you for work) to track their invoices, payments and your real hourly rate.</p><button class="btn block" data-act="client-new">Add a client</button>'}
      </section>
    </div>
  </div>`;
}

// ---------- Clients ----------

function clientSheet(p = null) {
  const { state } = ctx;
  const others = state.people.filter((x) => !x.client);
  ctx.openSheet(`<h3>${p ? esc(p.name) : 'Add a client'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="cl-form" novalidate>
      ${p ? `<label class="field"><span>Name</span><input id="cl-name" type="text" value="${esc(p.name)}"></label>` : `<label class="field"><span>Name (or someone from People)</span><input id="cl-name" type="text" list="cl-people" placeholder="e.g. Acme LLC"><datalist id="cl-people">${others.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></label>`}
      <div class="row2">
        <label class="field"><span>Hourly rate (optional)</span><input id="cl-rate" type="text" inputmode="decimal" value="${p?.rate ? esc(centsToPlain(p.rate)) : ''}" placeholder="e.g. 25"></label>
        <label class="field"><span>Currency</span><select id="cl-cur">${FIAT.map((f) => `<option value="${f.code}" ${f.code === (p?.currency || 'USD') ? 'selected' : ''}>${f.code}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Billing details (shown on invoices)</span><textarea id="cl-addr" rows="3" placeholder="Company, address, email">${esc(p?.address || '')}</textarea></label>
      <p class="lock-msg" id="cl-msg" role="alert"></p>
      <div class="btns">${p ? '<button type="button" class="btn" data-act="cl-unmark">Not a client anymore</button>' : ''}<button class="btn primary" type="submit">${p ? 'Save' : 'Add client'}</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#cl-name').focus();
    sheet.querySelector('[data-act="cl-unmark"]')?.addEventListener('click', () => {
      p.client = false;
      M.touch(p);
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`${p.name} is back to People only. Records stay.`);
    });
    sheet.querySelector('#cl-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = sheet.querySelector('#cl-name').value.trim();
      if (!name) { sheet.querySelector('#cl-msg').textContent = 'Type a name.'; return; }
      const person = p || M.person(state, M.ensurePerson(state, name));
      if (p) person.name = name;
      person.client = true;
      person.rate = evalAmount(sheet.querySelector('#cl-rate').value) || null;
      person.currency = sheet.querySelector('#cl-cur').value;
      person.address = sheet.querySelector('#cl-addr').value.trim();
      M.touch(person);
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(p ? 'Saved' : `${name} added as a client`);
    });
  });
}

// ---------- Invoices ----------

function invoiceSheet(existing = null) {
  const { state } = ctx;
  const today = todayISO();
  const clients = state.people.filter((p) => p.client);
  if (!clients.length) { clientSheet(); ctx.toast('Add the client first'); return; }
  const inv = existing ? structuredClone(existing) : I.newInvoice(state, clients[0], today, { id: M.uid() });
  if (!inv.items.length) inv.items.push({ desc: '', hours: '', rate: null, amount: null });

  const st = () => I.invoiceStatus(inv, today);
  const lineHTML = (l, i) => `<div class="inv-line" data-i="${i}">
    <input data-f="desc" type="text" value="${esc(l.desc || '')}" placeholder="What you did" aria-label="Description">
    <input data-f="hours" type="text" inputmode="decimal" value="${esc(l.hours ?? '')}" placeholder="Hours" aria-label="Hours">
    <input data-f="rate" type="text" inputmode="decimal" value="${Number.isInteger(l.rate) ? esc(centsToPlain(l.rate)) : ''}" placeholder="Rate" aria-label="Rate per hour">
    <input data-f="amount" type="text" inputmode="decimal" value="${Number(l.hours) > 0 && Number.isInteger(l.rate) ? esc(centsToPlain(I.lineAmount(l))) : Number.isInteger(l.amount) ? esc(centsToPlain(l.amount)) : ''}" placeholder="Amount" aria-label="Amount" ${Number(l.hours) > 0 && Number.isInteger(l.rate) ? 'readonly tabindex="-1"' : ''}>
    <button type="button" class="icon-btn" data-del="${i}" aria-label="Remove line">✕</button></div>`;

  const html = () => `<div class="grab"></div><h3><span>${existing ? esc(inv.number) : 'New invoice'} ${existing ? pill(st()) : ''}</span> <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="inv-form" novalidate>
      <div class="row2">
        <label class="field"><span>Client</span><select id="inv-client">${clients.map((c) => `<option value="${esc(c.id)}" ${c.id === inv.client ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Number</span><input id="inv-number" type="text" value="${esc(inv.number)}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Date</span><input id="inv-date" type="date" value="${esc(inv.date)}"></label>
        <label class="field"><span>Due</span><input id="inv-due" type="date" value="${esc(inv.due || '')}"></label>
      </div>
      <label class="field"><span>Currency</span><select id="inv-cur">${FIAT.map((f) => `<option value="${f.code}" ${f.code === inv.currency ? 'selected' : ''}>${f.code} · ${esc(f.name)}</option>`).join('')}</select></label>
      <div class="inv-head"><span>Description</span><span>Hours</span><span>Rate</span><span>Amount</span><span></span></div>
      <div id="inv-lines">${inv.items.map(lineHTML).join('')}</div>
      <div class="inv-total"><button type="button" class="card-link" data-add-line>+ Line</button><span>Total <b id="inv-sum">${formatMoney(I.invoiceTotal(inv), inv.currency)}</b></span></div>
      <label class="field"><span>Note on the invoice (optional)</span><input id="inv-note" type="text" value="${esc(inv.note || '')}" placeholder="e.g. Payment by bank transfer to …"></label>
      <p class="lock-msg" id="inv-msg" role="alert"></p>
      <div class="btns">
        ${existing ? '<button type="button" class="btn danger" data-inv="delete">Delete</button>' : ''}
        <button type="button" class="btn" data-inv="print">Print / PDF</button>
        ${st() === 'paid' ? '<button type="button" class="btn" data-inv="unpay">Mark unpaid</button>' : st() === 'draft' ? '<button type="button" class="btn" data-inv="send">Mark as sent</button>' : '<button type="button" class="btn" data-inv="pay">Mark paid…</button>'}
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`;

  const read = (sheet) => {
    const v = (id) => sheet.querySelector(id).value;
    inv.client = v('#inv-client');
    inv.number = v('#inv-number').trim() || inv.number;
    inv.date = v('#inv-date') || inv.date;
    inv.due = v('#inv-due') || null;
    inv.currency = v('#inv-cur');
    inv.note = v('#inv-note').trim();
    inv.items = [...sheet.querySelectorAll('.inv-line')].map((row) => {
      const f = (k) => row.querySelector(`[data-f="${k}"]`).value.trim();
      const hours = Number(f('hours').replace(',', '.')) || '';
      const rate = evalAmount(f('rate')) || null;
      return { desc: f('desc'), hours, rate, amount: hours && rate ? null : evalAmount(f('amount')) || null };
    });
  };

  const save = (sheet, msg) => {
    read(sheet);
    inv.items = inv.items.filter((l) => l.desc || I.lineAmount(l));
    if (!I.invoiceTotal(inv)) { sheet.querySelector('#inv-msg').textContent = 'Add at least one line with an amount (or hours and a rate).'; return false; }
    inv.updatedAt = Date.now();
    const list = state.invoices || (state.invoices = []);
    const i = list.findIndex((x) => x.id === inv.id);
    if (i >= 0) list[i] = inv; else list.push(inv);
    ctx.commit();
    if (msg) ctx.toast(msg);
    return true;
  };

  ctx.openSheet('', (sheet) => {
    const paint = () => { sheet.innerHTML = html(); };
    paint();
    sheet.addEventListener('input', (e) => {
      if (!e.target.closest('.inv-line')) return;
      read(sheet);
      sheet.querySelector('#inv-sum').textContent = formatMoney(I.invoiceTotal(inv), inv.currency);
      const row = e.target.closest('.inv-line');
      const l = inv.items[row.dataset.i];
      const amt = row.querySelector('[data-f="amount"]');
      const auto = Number(l.hours) > 0 && Number.isInteger(l.rate);
      amt.readOnly = auto;
      if (auto) amt.value = centsToPlain(I.lineAmount(l));
    });
    sheet.addEventListener('change', (e) => {
      if (e.target.id === 'inv-client') {
        read(sheet);
        const c = M.person(state, inv.client);
        if (c?.currency) inv.currency = c.currency;
        for (const l of inv.items) if (!l.rate && c?.rate) l.rate = c.rate;
        paint();
      }
      if (e.target.id === 'inv-cur') { read(sheet); sheet.querySelector('#inv-sum').textContent = formatMoney(I.invoiceTotal(inv), inv.currency); }
    });
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-line]')) {
        read(sheet);
        inv.items.push({ desc: '', hours: '', rate: M.person(state, inv.client)?.rate || null, amount: null });
        paint();
        sheet.querySelector('.inv-line:last-child [data-f="desc"]').focus();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) { read(sheet); inv.items.splice(Number(del.dataset.del), 1); if (!inv.items.length) inv.items.push({ desc: '', hours: '', rate: null, amount: null }); paint(); return; }
      const b = e.target.closest('[data-inv]');
      if (!b) return;
      const k = b.dataset.inv;
      if (k === 'delete') {
        state.invoices = state.invoices.filter((x) => x.id !== inv.id);
        state.deleted[inv.id] = Date.now();
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${inv.number} deleted${inv.paidTx ? '. Its payment record stays in the log.' : ''}`);
      } else if (k === 'print') {
        if (save(sheet)) printInvoice(inv);
      } else if (k === 'send') {
        inv.sent = true;
        if (save(sheet, `${inv.number} marked as sent`)) paint();
      } else if (k === 'pay') {
        if (save(sheet)) paySheet(inv);
      } else if (k === 'unpay') {
        if (inv.paidTx) M.removeTx(state, inv.paidTx);
        inv.paidDate = null;
        inv.paidTx = null;
        if (save(sheet, 'Marked unpaid; its income record was removed')) paint();
      }
    });
    sheet.querySelector('#inv-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (save(sheet, existing ? 'Saved' : `${inv.number} saved as a draft`)) ctx.closeSheet();
    });
  });
}

// When the money arrives: which account, how much landed (after fees or
// conversion), and the rate to the main currency.
function paySheet(inv) {
  const { state } = ctx;
  const accounts = M.activeAccounts(state);
  const total = I.invoiceTotal(inv);
  let acc = accounts.find((a) => a.currency === inv.currency && a.kind !== 'crypto') || accounts[0];
  const received = (a) => (a.currency === inv.currency ? total : convert(total, inv.currency, a.currency, state.rates) || total);
  ctx.openSheet(`<h3>${esc(inv.number)} paid <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="pay-form" novalidate>
      <p class="muted small" style="margin-top:0">${esc(clientName(inv.client))} · invoice total ${formatMoney(total, inv.currency)}. This logs the income into the account it landed in.</p>
      <div class="row2">
        <label class="field"><span>Arrived in</span><select id="pay-acc">${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === acc.id ? 'selected' : ''}>${esc(a.name)} · ${esc(a.currency)}</option>`).join('')}</select></label>
        <label class="field"><span>On</span><input id="pay-date" type="date" value="${todayISO()}"></label>
      </div>
      <label class="field"><span>Amount that arrived (<span id="pay-cur">${esc(acc.currency)}</span>, after fees)</span><input id="pay-amt" type="text" inputmode="decimal" value="${esc(centsToPlain(received(acc)))}"></label>
      <p class="lock-msg" id="pay-msg" role="alert"></p>
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Log the payment</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#pay-acc').addEventListener('change', (e) => {
      acc = M.account(state, e.target.value);
      sheet.querySelector('#pay-cur').textContent = acc.currency;
      sheet.querySelector('#pay-amt').value = centsToPlain(received(acc));
    });
    sheet.querySelector('#pay-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = evalAmount(sheet.querySelector('#pay-amt').value);
      if (!amount || amount <= 0) { sheet.querySelector('#pay-msg').textContent = 'Enter the amount that arrived.'; return; }
      const rate = acc.currency === base() ? 1 : ctx.suggestedRate(acc.currency);
      if (!rate) { sheet.querySelector('#pay-msg').textContent = `No ${acc.currency} rate yet. Update rates (Rates screen) and try again.`; return; }
      const date = sheet.querySelector('#pay-date').value || todayISO();
      const category = state.settings.categories.some((c) => c.id === 'side') ? 'side' : 'work';
      const t = I.paymentTx(inv, { id: M.uid(), account: acc.id, date, rate, amount, currency: acc.currency, category });
      state.tx.push(t);
      const live = state.invoices.find((x) => x.id === inv.id);
      Object.assign(live, { sent: true, paidDate: date, paidTx: t.id, updatedAt: Date.now() });
      ctx.ui.flashId = t.id;
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`${inv.number} paid: +${formatMoney(amount, acc.currency)} logged in ${acc.name}`);
      setTimeout(() => ctx.openSplit(t), 250);
    });
  });
}

// ---------- Print / PDF ----------

function printInvoice(inv) {
  const { state } = ctx;
  const c = M.person(state, inv.client) || {};
  const from = state.settings.invoiceFrom || '';
  const fm = (x) => formatMoney(x, inv.currency);
  const root = document.getElementById('print-root');
  root.innerHTML = `<article class="invoice">
    <header><div><h1>Invoice</h1><p>${esc(inv.number)}</p></div><div class="inv-from">${esc(from).replace(/\n/g, '<br>') || '<i>Add your name and details in Clients → Invoices → Your details</i>'}</div></header>
    <section class="inv-meta"><div><span>Bill to</span><b>${esc(c.name || '')}</b>${c.address ? `<p>${esc(c.address).replace(/\n/g, '<br>')}</p>` : ''}</div>
      <div><span>Date</span><b>${esc(inv.date)}</b>${inv.due ? `<span>Due</span><b>${esc(inv.due)}</b>` : ''}</div></section>
    <table><thead><tr><th>Description</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${inv.items.filter((l) => l.desc || I.lineAmount(l)).map((l) => `<tr><td>${esc(l.desc)}</td><td>${Number(l.hours) > 0 ? esc(hoursText(Number(l.hours))) : ''}</td><td>${Number.isInteger(l.rate) && Number(l.hours) > 0 ? fm(l.rate) : ''}</td><td>${fm(I.lineAmount(l))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td>${fm(I.invoiceTotal(inv))}</td></tr></tfoot></table>
    ${inv.note ? `<p class="inv-note">${esc(inv.note)}</p>` : ''}
  </article>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  if (ctx.DEMO) { setTimeout(done, 4000); ctx.toast('Printing works in the installed app; this is how it looks.'); return; }
  setTimeout(() => window.print(), 50);
}

function detailsSheet() {
  ctx.openSheet(`<h3>Your details on invoices <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="from-form"><label class="field"><span>Name, address, email, bank details</span><textarea id="from-text" rows="6" placeholder="Your name&#10;Address&#10;Email&#10;IBAN / SWIFT">${esc(ctx.state.settings.invoiceFrom || '')}</textarea></label>
    <div class="btns"><button class="btn primary" type="submit">Save</button></div></form>`, (sheet) => {
    sheet.querySelector('#from-form').addEventListener('submit', (e) => {
      e.preventDefault();
      ctx.state.settings.invoiceFrom = sheet.querySelector('#from-text').value.trim();
      ctx.state.settings.updatedAt = Date.now();
      ctx.commit();
      ctx.closeSheet();
      ctx.toast('Saved');
    });
  });
}

export function onClick(act, el) {
  if (act === 'inv-new') { invoiceSheet(); return true; }
  if (act === 'inv-open') { const inv = (ctx.state.invoices || []).find((i) => i.id === el.dataset.id); if (inv) invoiceSheet(inv); return true; }
  if (act === 'client-new') { clientSheet(); return true; }
  if (act === 'client-open') { const p = M.person(ctx.state, el.dataset.id); if (p) clientSheet(p); return true; }
  if (act === 'inv-details') { detailsSheet(); return true; }
  return false;
}
