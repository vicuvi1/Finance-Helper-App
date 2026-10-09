// People: who gave you money and who you gave to, with dates and reasons,
// and open loans (who owes whom). Every row is a record with a person on it.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { todayISO, dayLabel } from '../dates.js';

const initialOf = (name) => esc((String(name).match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase());

function balancePill(r) {
  if (r.owesMe > 0) return `<span class="pill pill-in">owes you ${ctx.money(r.owesMe)}</span>`;
  if (r.owesMe < 0) return `<span class="pill pill-out">you owe ${ctx.money(-r.owesMe)}</span>`;
  return '';
}

export function view() {
  const { state } = ctx;
  const year = todayISO().slice(0, 4);
  const all = M.peopleSummary(state);
  const thisYear = new Map(M.peopleSummary(state, { from: `${year}-01-01` }).map((r) => [r.person.id, r]));
  const owedToMe = all.reduce((a, r) => a + Math.max(0, r.owesMe), 0);
  const iOwe = all.reduce((a, r) => a + Math.max(0, -r.owesMe), 0);
  const q = (ctx.ui.peopleSearch || '').trim().toLowerCase();
  const rows = all.filter((r) => !q || r.person.name.toLowerCase().includes(q));
  const yr = [...thisYear.values()];
  const received = yr.reduce((a, r) => a + r.received, 0);
  const given = yr.reduce((a, r) => a + r.given, 0);

  const list = rows.map((r, i) => {
    const y = thisYear.get(r.person.id);
    return `<button class="tx person-row" data-act="person-open" data-id="${esc(r.person.id)}">
      <span class="av" style="--c:var(--c${(i % 8) + 1})" aria-hidden="true">${initialOf(r.person.name)}</span>
      <span class="t"><b>${esc(r.person.name)} ${balancePill(r)}</b><span>${r.last ? `Last: ${esc(dayLabel(r.last))} ${esc(r.last.slice(0, 4))}` : 'No records yet'}${r.count ? ` · ${r.count} record${r.count === 1 ? '' : 's'}` : ''}${r.person.note ? ` · ${esc(r.person.note)}` : ''}</span></span>
      <span class="amount person-amt">${r.received ? `<span class="income">+${ctx.money(r.received)}</span>` : ''}${r.given ? `<span>−${ctx.money(r.given)}</span>` : ''}${y && (y.received || y.given) && (y.received !== r.received || y.given !== r.given) ? `<span class="sub-amt">${year}: +${ctx.money(y.received)} / −${ctx.money(y.given)}</span>` : ''}</span>
    </button>`;
  }).join('');

  return `<header class="top"><div><h1>People</h1><div class="sub">Who gave you money, who you gave to, and loans</div></div>
    <button class="btn primary" data-act="person-new">+ Add person</button></header>
  <section class="hero">
    <div class="hero-main">
      <div class="label">Owed to you</div>
      <div class="big">${ctx.bigMoney(owedToMe)}</div>
      <p class="muted" style="margin:0">${iOwe ? `You owe others ${ctx.money(iOwe)}.` : 'You owe nobody.'}</p>
    </div>
    <div class="hero-month">
      <div class="label">${year} with people</div>
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="stat"><span class="k">Received from people</span><b class="income">${ctx.countUp(received, 'ppl-in')}</b></div>
        <div class="stat"><span class="k">Given to people</span><b class="expense">${ctx.countUp(given, 'ppl-out')}</b></div>
      </div>
    </div>
  </section>
  <div class="search"><input type="search" id="people-search" placeholder="Find a person" value="${esc(ctx.ui.peopleSearch || '')}" aria-label="Find a person"></div>
  ${rows.length ? `<div class="list">${list}</div>` : `<div class="empty"><b>${q ? 'Nobody with that name' : 'No people yet'}</b>${q ? '' : 'When you log money from or to someone, type their name in "From who?" or "To who?". Or add them here.'}</div>`}`;
}

function openPerson(id) {
  const { state } = ctx;
  const p = M.person(state, id);
  if (!p) return;
  const r = M.peopleSummary(state).find((x) => x.person.id === id);
  const items = M.sortTx(state.tx.filter((t) => t.person === id));
  const repay = r.owesMe > 0
    ? { type: 'income', loan: true, label: `${p.name} paid back` }
    : r.owesMe < 0 ? { type: 'expense', loan: true, label: `I paid ${p.name} back` } : null;
  ctx.openSheet(`<h3>${esc(p.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><span class="k">Received</span><b class="income">${ctx.money(r.received)}</b></div>
      <div class="stat"><span class="k">Given</span><b class="expense">${ctx.money(r.given)}</b></div>
      <div class="stat"><span class="k">${r.owesMe > 0 ? 'Owes you' : r.owesMe < 0 ? 'You owe' : 'Loans'}</span><b class="${r.owesMe ? 'gold' : ''}">${r.owesMe ? ctx.money(Math.abs(r.owesMe)) : 'settled'}</b></div>
    </div>
    <div class="btns" style="margin-bottom:12px">
      <button class="btn" data-p="income">${esc(p.name)} gave me</button>
      <button class="btn" data-p="expense">I gave ${esc(p.name)}</button>
      <button class="btn" data-p="lend">I lent</button>
      ${repay ? `<button class="btn primary" data-p="repay">${esc(repay.label)}</button>` : ''}
    </div>
    <label class="field"><span>Note about ${esc(p.name)}</span><input id="p-note" type="text" value="${esc(p.note || '')}" placeholder="e.g. brother, client from the US"></label>
    <label class="field"><span>Name</span><input id="p-name" type="text" value="${esc(p.name)}"></label>
    ${items.length ? `<div class="list">${items.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records with this person yet.</p>'}
    ${items.length ? '' : '<div class="btns" style="margin-top:12px"><button class="btn danger" data-p="delete">Delete person</button></div>'}`, (sheet) => {
    const save = () => {
      const name = sheet.querySelector('#p-name').value.trim();
      const note = sheet.querySelector('#p-note').value.trim();
      if ((name && name !== p.name) || note !== (p.note || '')) {
        if (name) p.name = name;
        p.note = note;
        M.touch(p);
        ctx.commit();
      }
    };
    sheet.querySelector('#p-name').addEventListener('change', save);
    sheet.querySelector('#p-note').addEventListener('change', save);
    sheet.addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); return; }
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const k = b.dataset.p;
      if (k === 'delete') {
        ctx.state.people = ctx.state.people.filter((x) => x.id !== id);
        ctx.state.deleted[id] = Date.now();
        ctx.commit();
        ctx.closeSheet();
        ctx.toast(`${p.name} removed`);
        return;
      }
      ctx.closeSheet();
      if (k === 'income') ctx.openTxSheet(null, { type: 'income', personName: p.name });
      else if (k === 'expense') ctx.openTxSheet(null, { type: 'expense', personName: p.name });
      else if (k === 'lend') ctx.openTxSheet(null, { type: 'expense', personName: p.name, loan: true, note: 'loan' });
      else if (k === 'repay') ctx.openTxSheet(null, { type: repay.type, personName: p.name, loan: true, note: 'paid back', amountText: String(Math.abs(r.owesMe) / 100) });
    });
  });
}

function addPerson() {
  ctx.openSheet(`<h3>Add person <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="p-form"><label class="field"><span>Name</span><input id="p-new" type="text" placeholder="e.g. Ana, Mom, US client" required></label>
    <label class="field"><span>Note (optional)</span><input id="p-new-note" type="text" placeholder="e.g. brother, client"></label>
    <div class="btns"><button class="btn primary" type="submit">Add</button></div></form>`, (sheet) => {
    sheet.querySelector('#p-new').focus();
    sheet.querySelector('#p-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = M.ensurePerson(ctx.state, sheet.querySelector('#p-new').value);
      if (!id) return;
      const note = sheet.querySelector('#p-new-note').value.trim();
      if (note) M.person(ctx.state, id).note = note;
      ctx.commit();
      ctx.closeSheet();
    });
  });
}

export function onClick(act, el) {
  if (act === 'person-open') { openPerson(el.dataset.id); return true; }
  if (act === 'person-new') { addPerson(); return true; }
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
