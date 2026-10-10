// People: who gave you money, who you gave to, and loans (who owes whom),
// grouped (Family, Friends, Work…). Loans are kept in the currency they were
// made in, so "owes you 100 USD" stays 100 USD whatever the rate. Each person
// can be edited fully (name, group, currency, note) or deleted; their records
// stay, with the name written on them.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { todayISO, dayLabel } from '../dates.js';
import { formatMoney, evalAmount } from '../money.js';
import { convert, FIAT } from '../fx.js';

const initialOf = (name) => esc((String(name).match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase());
const colorOf = (p) => {
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return `var(--c${(h % 8) + 1})`;
};
const fmtOwes = (owes, sign = 1) => Object.entries(owes).filter(([, v]) => v * sign > 0).map(([cur, v]) => formatMoney(Math.abs(v), cur)).join(' · ');
const currencies = () => {
  const { state } = ctx;
  return [...new Set([state.settings.currency, ...state.settings.accounts.map((a) => a.currency), ...FIAT.map((f) => f.code)])].filter(Boolean);
};

// No group set yet: a good guess from the name or note.
const FAMILY = /mother|mom|mum|mama|mamica|father|dad|tata|tatic|brother|frate|sister|sora|grand|bunic|aunt|uncle|matusa|unchi|cousin|var\b|wife|husband|sotie|sot\b|family|familie/i;
function guessGroup(p) {
  if (p.client) return 'Clients';
  if (FAMILY.test(`${p.name} ${p.note || ''}`)) return 'Family';
  return 'Other';
}

function badge(r) {
  const plus = fmtOwes(r.owes, 1);
  const minus = fmtOwes(r.owes, -1);
  return `${plus ? `<span class="pp-badge in">owes you ${esc(plus)}</span>` : ''}${minus ? `<span class="pp-badge out">you owe ${esc(minus)}</span>` : ''}`;
}

function card(r, y) {
  const p = r.person;
  const max = Math.max(1, r.received, r.given);
  return `<button type="button" class="pp-card" data-act="person-open" data-id="${esc(p.id)}" style="--pc:${colorOf(p)}">
    <span class="pp-top"><span class="pp-av" aria-hidden="true">${initialOf(p.name)}</span>
      <span class="pp-name"><b>${esc(p.name)}</b><span>${esc([p.note, p.currency && p.currency !== ctx.state.settings.currency ? p.currency : ''].filter(Boolean).join(' · ') || (r.last ? `Last ${dayLabel(r.last)} ${r.last.slice(0, 4)}` : 'No records yet'))}</span></span></span>
    <span class="pp-badges">${badge(r) || '<span class="pp-badge none">no open loans</span>'}</span>
    <span class="pp-flow">
      <span class="pp-row"><span>Received</span><b class="income">${r.received ? ctx.money(r.received) : '–'}</b></span>
      <span class="pp-bar"><i class="in" style="width:${(r.received / max) * 100}%"></i></span>
      <span class="pp-row"><span>Given</span><b>${r.given ? ctx.money(r.given) : '–'}</b></span>
      <span class="pp-bar"><i class="out" style="width:${(r.given / max) * 100}%"></i></span>
    </span>
    <span class="pp-foot">${r.count} record${r.count === 1 ? '' : 's'}${y && (y.received || y.given) ? ` · ${todayISO().slice(0, 4)}: +${ctx.money(y.received)} / −${ctx.money(y.given)}` : ''}</span>
  </button>`;
}

export function view() {
  const { state, ui } = ctx;
  const year = todayISO().slice(0, 4);
  const all = M.peopleSummary(state);
  const thisYear = new Map(M.peopleSummary(state, { from: `${year}-01-01` }).map((r) => [r.person.id, r]));
  const q = (ui.peopleSearch || '').trim().toLowerCase();
  const groupOf = (p) => p.group || guessGroup(p);
  const groups = [...new Set([...M.PERSON_GROUPS, ...state.people.map(groupOf)])].filter((g) => state.people.some((p) => groupOf(p) === g));
  const pick = groups.includes(ui.peopleGroup) ? ui.peopleGroup : 'all';
  const rows = all.filter((r) => (!q || `${r.person.name} ${r.person.note || ''}`.toLowerCase().includes(q)) && (pick === 'all' || groupOf(r.person) === pick));
  // Totals per currency.
  const owed = {};
  const iOwe = {};
  for (const r of all) for (const [cur, v] of Object.entries(r.owes)) (v > 0 ? owed : iOwe)[cur] = ((v > 0 ? owed : iOwe)[cur] || 0) + Math.abs(v);
  const yr = [...thisYear.values()];
  const received = yr.reduce((a, r) => a + r.received, 0);
  const given = yr.reduce((a, r) => a + r.given, 0);
  const list = (rs) => rs.map((r) => card(r, thisYear.get(r.person.id))).join('');
  const sections = pick === 'all' && !q
    ? groups.map((g) => { const rs = rows.filter((r) => groupOf(r.person) === g); return rs.length ? `<section class="pp-group"><h2>${esc(g)} <span class="muted">${rs.length}</span></h2><div class="pp-grid">${list(rs)}</div></section>` : ''; }).join('')
    : `<div class="pp-grid">${list(rows)}</div>`;
  const tot = (o) => Object.entries(o).map(([cur, v]) => `<b>${esc(formatMoney(v, cur))}</b>`).join('<span class="muted"> · </span>') || '<b>0</b>';

  return `<header class="top"><div><h1>People</h1><div class="sub">Who gave you money, who you gave to, and loans</div></div>
    <div class="btns-inline"><button class="btn" data-act="loan-new">+ Loan</button><button class="btn primary" data-act="person-new">+ Add person</button></div></header>
  <section class="pp-sum">
    <div class="pp-tile"><span>Owed to you</span><div class="pp-big income">${tot(owed)}</div></div>
    <div class="pp-tile"><span>You owe</span><div class="pp-big ${Object.keys(iOwe).length ? 'expense' : ''}">${Object.keys(iOwe).length ? tot(iOwe) : '<b>nobody</b>'}</div></div>
    <div class="pp-tile"><span>Received from people · ${year}</span><div class="pp-big">${ctx.countUp(received, 'ppl-in')}</div></div>
    <div class="pp-tile"><span>Given to people · ${year}</span><div class="pp-big">${ctx.countUp(given, 'ppl-out')}</div></div>
  </section>
  <div class="pp-tools">
    <input type="search" id="people-search" placeholder="Find a person" value="${esc(ui.peopleSearch || '')}" aria-label="Find a person">
    <div class="chips">${['all', ...groups].map((g) => `<button class="chip" data-act="people-group" data-group="${esc(g)}" aria-pressed="${pick === g}">${g === 'all' ? 'Everyone' : esc(g)}</button>`).join('')}</div>
  </div>
  ${rows.length ? sections : `<div class="empty"><b>${q ? 'Nobody with that name' : 'No people yet'}</b>${q ? '' : 'Add people here, or type a name in "Who" when you log money from or to someone.'}</div>`}`;
}

// ---------- One person: edit everything ----------

function openPerson(id) {
  const { state } = ctx;
  const p = M.person(state, id);
  if (!p) return;
  const r = M.peopleSummary(state).find((x) => x.person.id === id);
  const items = M.sortTx(state.tx.filter((t) => t.person === id));
  const groupOpts = [...new Set([...M.PERSON_GROUPS, ...state.people.map((x) => x.group).filter(Boolean)])];
  const owesLine = badge(r);
  ctx.openSheet(`<h3><span class="pp-av sm" style="--pc:${colorOf(p)}" aria-hidden="true">${initialOf(p.name)}</span> ${esc(p.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    ${owesLine ? `<div class="pp-badges" style="margin-bottom:12px">${owesLine}</div>` : ''}
    <div class="btns" style="margin-bottom:14px">
      <button class="btn primary" data-p="loan">+ Loan or payback</button>
      <button class="btn" data-p="income">${esc(p.name)} gave me</button>
      <button class="btn" data-p="expense">I gave ${esc(p.name)}</button>
    </div>
    <div class="row2">
      <label class="field"><span>Name</span><input id="p-name" type="text" value="${esc(p.name)}"></label>
      <label class="field"><span>Group</span><input id="p-group" type="text" list="pp-groups" value="${esc(p.group || '')}" placeholder="Family, Friends, Work…"><datalist id="pp-groups">${groupOpts.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></label>
    </div>
    <div class="row2">
      <label class="field"><span>Usual currency</span><select id="p-cur">${currencies().map((c) => `<option ${c === (p.currency || state.settings.currency) ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>Note</span><input id="p-note" type="text" value="${esc(p.note || '')}" placeholder="e.g. brother, client from the US"></label>
    </div>
    <div class="pp-sheet-stats"><span>Received <b class="income">${ctx.money(r.received)}</b></span><span>Given <b>${ctx.money(r.given)}</b></span><span>${r.count} records</span></div>
    ${items.length ? `<div class="list">${items.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records with this person yet.</p>'}
    <div class="pp-danger" id="pp-danger"><button class="btn danger" data-p="delete">Delete ${esc(p.name)}</button></div>`, (sheet) => {
    const save = () => {
      const name = sheet.querySelector('#p-name').value.trim();
      const next = { name: name || p.name, note: sheet.querySelector('#p-note').value.trim(), group: sheet.querySelector('#p-group').value.trim(), currency: sheet.querySelector('#p-cur').value };
      if (name && name.toLowerCase() !== p.name.toLowerCase() && state.people.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) {
        ctx.toast(`There is already someone called ${name}`);
        sheet.querySelector('#p-name').value = p.name;
        return;
      }
      if (Object.entries(next).every(([k, v]) => (p[k] || '') === v)) return;
      Object.assign(p, next);
      M.touch(p);
      ctx.commit();
    };
    for (const sel of ['#p-name', '#p-note', '#p-group', '#p-cur']) sheet.querySelector(sel).addEventListener('change', save);
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); return; }
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const k = b.dataset.p;
      if (k === 'delete') {
        // Confirm in place (no pop-ups): what happens to the records.
        sheet.querySelector('#pp-danger').innerHTML = `<p class="small" style="margin:0 0 8px">Delete <b>${esc(p.name)}</b>? ${items.length ? `The ${items.length} record${items.length === 1 ? '' : 's'} stay, with the name written on them.` : ''}</p>
          <div class="btns"><button class="btn" data-p="keep">Keep</button><button class="btn danger" data-p="delete-yes">Delete</button></div>`;
        return;
      }
      if (k === 'keep') { sheet.querySelector('#pp-danger').innerHTML = `<button class="btn danger" data-p="delete">Delete ${esc(p.name)}</button>`; return; }
      if (k === 'delete-yes') {
        M.deletePerson(ctx.state, id);
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${p.name} deleted`, 'Undo', () => ctx.undo?.());
        return;
      }
      ctx.closeSheet();
      if (k === 'loan') setTimeout(() => openLoan(id), 200);
      else if (k === 'income') ctx.openTxSheet(null, { type: 'income', personName: p.name });
      else if (k === 'expense') ctx.openTxSheet(null, { type: 'expense', personName: p.name });
    });
  });
}

// ---------- A loan or a payback, in any currency ----------

const KINDS = [
  { id: 'lent', label: 'I lent', type: 'expense', note: 'loan' },
  { id: 'borrowed', label: 'I borrowed', type: 'income', note: 'borrowed' },
  { id: 'back-in', label: 'They paid me back', type: 'income', note: 'paid back' },
  { id: 'back-out', label: 'I paid back', type: 'expense', note: 'paid back' },
];

function openLoan(personId = null) {
  const { state } = ctx;
  const people = [...state.people].sort((a, b) => a.name.localeCompare(b.name));
  let pid = personId || people[0]?.id || '';
  const r0 = () => M.peopleSummary(state).find((x) => x.person.id === pid);
  // Paying back is the likely thing when there's an open loan.
  const open = r0() && Object.values(r0().owes).find((v) => v);
  let kind = open > 0 ? 'back-in' : open < 0 ? 'back-out' : 'lent';
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const curOf = () => M.person(state, pid)?.currency || state.settings.currency;
  const accFor = (cur) => accs.find((a) => a.currency === cur)?.id || accs[0]?.id;
  ctx.openSheet(`<h3>Loan or payback <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="loan-form" autocomplete="off">
      <div class="seg loan-kinds" role="group" aria-label="What happened">${KINDS.map((k) => `<button type="button" data-kind="${k.id}" aria-pressed="${k.id === kind}">${k.label}</button>`).join('')}</div>
      <label class="field"><span>Who</span><input id="loan-who" type="text" list="loan-people" value="${esc(M.person(state, pid)?.name || '')}" placeholder="Name" required><datalist id="loan-people">${people.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></label>
      <div class="row2">
        <label class="field"><span>Amount</span><input id="loan-amt" type="text" inputmode="decimal" placeholder="0" required></label>
        <label class="field"><span>Currency</span><select id="loan-cur">${currencies().map((c) => `<option ${c === curOf() ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label class="field"><span>Money from / into</span><select id="loan-acc">${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === accFor(curOf()) ? 'selected' : ''}>${esc(a.name)} (${esc(a.currency)})</option>`).join('')}</select></label>
        <label class="field"><span>Date</span><input id="loan-date" type="date" value="${todayISO()}"></label>
      </div>
      <label class="field"><span>Note</span><input id="loan-note" type="text" placeholder="optional"></label>
      <p class="muted small" id="loan-hint"></p>
      <div class="btns"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
    </form>`, (sheet) => {
    const $ = (s) => sheet.querySelector(s);
    const hint = () => {
      const amount = evalAmount($('#loan-amt').value);
      const cur = $('#loan-cur').value;
      const acc = M.account(state, $('#loan-acc').value);
      const r = M.peopleSummary(state).find((x) => x.person.name.toLowerCase() === $('#loan-who').value.trim().toLowerCase());
      const owes = r ? [badge(r).replace(/<[^>]+>/g, ' ').trim()].filter(Boolean)[0] : '';
      let txt = owes ? `Now: ${owes}.` : '';
      if (amount && acc && acc.currency !== cur) {
        const conv = convert(amount, cur, acc.currency, state.rates);
        txt += conv == null ? ` No ${cur}→${acc.currency} rate yet: pick an account in ${cur}.` : ` ${formatMoney(amount, cur)} = ${formatMoney(conv, acc.currency)} from ${acc.name} today; the debt stays in ${cur}.`;
      }
      $('#loan-hint').textContent = txt.trim();
    };
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      kind = b.dataset.kind;
      sheet.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.kind === kind));
    });
    $('#loan-cur').addEventListener('change', () => { $('#loan-acc').value = accFor($('#loan-cur').value); hint(); });
    for (const s of ['#loan-amt', '#loan-acc', '#loan-who']) $(s).addEventListener('input', hint);
    hint();
    setTimeout(() => $(pid ? '#loan-amt' : '#loan-who').focus(), 50);
    $('#loan-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const k = KINDS.find((x) => x.id === kind);
      const amount = evalAmount($('#loan-amt').value);
      if (!amount || amount <= 0) { ctx.toast('Type an amount'); return; }
      const who = M.ensurePerson(state, $('#loan-who').value);
      if (!who) { ctx.toast('Type who it is'); return; }
      const cur = $('#loan-cur').value;
      const acc = M.account(state, $('#loan-acc').value);
      const accCur = acc?.currency || state.settings.currency;
      const inAcc = accCur === cur ? amount : convert(amount, cur, accCur, state.rates);
      if (inAcc == null) { ctx.toast(`No ${cur} rate yet. Pick an account in ${cur} or update rates.`); return; }
      const rate = ctx.suggestedRate(accCur) || 1;
      const now = Date.now();
      const p = M.person(state, who);
      if (!p.currency && cur !== state.settings.currency) { p.currency = cur; M.touch(p, now); }
      state.tx.push({
        id: M.uid(), createdAt: now, updatedAt: now, type: k.type, amount: inAcc, currency: accCur, rate, base: Math.round(inAcc * rate),
        date: $('#loan-date').value || todayISO(), category: k.type === 'income' ? 'other-in' : 'other', account: acc.id,
        note: $('#loan-note').value.trim() || k.note, person: who, loan: true, ...(accCur !== cur ? { debt: { amount, currency: cur } } : {}),
      });
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(`${k.label}: ${formatMoney(amount, cur)} · ${p.name}`);
    });
  });
}

function addPerson() {
  const groups = [...new Set([...M.PERSON_GROUPS, ...ctx.state.people.map((x) => x.group).filter(Boolean)])];
  ctx.openSheet(`<h3>Add person <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="p-form"><label class="field"><span>Name</span><input id="p-new" type="text" placeholder="e.g. Ana, Mom, US client" required></label>
    <div class="row2">
      <label class="field"><span>Group</span><select id="p-new-group">${groups.map((g) => `<option>${esc(g)}</option>`).join('')}</select></label>
      <label class="field"><span>Usual currency</span><select id="p-new-cur">${currencies().map((c) => `<option>${c}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Note (optional)</span><input id="p-new-note" type="text" placeholder="e.g. brother, client"></label>
    <div class="btns"><button class="btn primary" type="submit">Add</button></div></form>`, (sheet) => {
    sheet.querySelector('#p-new').focus();
    sheet.querySelector('#p-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = M.ensurePerson(ctx.state, sheet.querySelector('#p-new').value);
      if (!id) return;
      const p = M.person(ctx.state, id);
      Object.assign(p, { note: sheet.querySelector('#p-new-note').value.trim(), group: sheet.querySelector('#p-new-group').value, currency: sheet.querySelector('#p-new-cur').value });
      M.touch(p);
      ctx.commit();
      ctx.closeSheet();
    });
  });
}

export function onClick(act, el) {
  if (act === 'person-open') { openPerson(el.dataset.id); return true; }
  if (act === 'person-new') { addPerson(); return true; }
  if (act === 'loan-new') { openLoan(); return true; }
  if (act === 'people-group') { ctx.ui.peopleGroup = el.dataset.group; ctx.render(); return true; }
  return false;
}

export function onInput(el) {
  if (el.id !== 'people-search') return false;
  ctx.ui.peopleSearch = el.value;
  const pos = el.selectionStart;
  ctx.render();
  const s = document.getElementById('people-search');
  s.focus();
  s.setSelectionRange(pos, pos);
  return true;
}

export { openPerson };
