// The wishlist (#wishlist), next to Plan: things you want, each locked for a
// few days ("Ready on 20 Nov"), then "Still want it? Buy / Remove". Buy opens
// the normal new-expense sheet filled in: the record is made only when you
// save it. Shows the total of the list and what you saved by waiting.
// The list is settings.wishlist (js/wishlist.js), so it syncs with the data.

import { ctx, esc } from '../ctx.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { todayISO } from '../dates.js';
import { shortDay } from '../safespend.js';
import * as Afford from './afford.js';
import { summary, statusOf, readyOn, daysLeft, addItem, removeItem, buyItem, putBack } from '../wishlist.js';
import * as Tips from '../tips.js';

const safeLink = (s) => (/^https?:\/\/\S+$/i.test(s) ? s : null);

function noteHTML(note) {
  if (!note) return '';
  const l = safeLink(note);
  return `<span class="wl-note">${l ? `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l.replace(/^https?:\/\//i, '').slice(0, 48))}</a>` : esc(note)}</span>`;
}

function itemRow(it, today, wait, cur) {
  const st = statusOf(it, today, wait);
  const price = formatMoney(it.price, cur);
  const added = `added ${shortDay(it.added)}`;
  const head = `<span class="t"><b>${esc(it.name)}</b><span>${added}${noteHTML(it.note) ? ' · ' : ''}${noteHTML(it.note)}</span></span><span class="v">${esc(price)}</span>`;
  if (st === 'locked') {
    const left = daysLeft(it, today, wait);
    return `<div class="tx wl-item locked" data-testid="wl-item" data-state="locked" data-id="${esc(it.id)}">${head}
      <div class="wl-line"><span class="wl-ready">Ready on ${esc(shortDay(readyOn(it, wait)))} · ${left} day${left === 1 ? '' : 's'} to go</span><button type="button" class="btn sm" data-act="wl-remove" data-id="${esc(it.id)}">Remove</button></div></div>`;
  }
  return `<div class="tx wl-item ready" data-testid="wl-item" data-state="ready" data-id="${esc(it.id)}">${head}
    <div class="wl-line"><span class="wl-ready">Still want it?</span><span class="btns"><button type="button" class="btn sm primary" data-act="wl-buy" data-id="${esc(it.id)}">Buy</button><button type="button" class="btn sm" data-act="wl-remove" data-id="${esc(it.id)}">Remove</button></span></div></div>`;
}

export function view() {
  const { state } = ctx;
  const today = todayISO();
  const cur = state.settings.currency;
  const s = summary(state);
  const whole = (c) => formatMoney(Math.round(c / 100) * 100, cur);
  return `<header class="top"><div><h1>Wishlist</h1><div class="sub">Wait ${s.wait} day${s.wait === 1 ? '' : 's'} before you buy · nothing is spent from here</div></div></header>
  <section class="card" data-testid="wishlist">
    <h2>Add something you want</h2>
    <div class="wl-form" id="wl-form">
      <label class="field"><span>Name</span><input id="wl-name" type="text" placeholder="e.g. Headphones" aria-label="Name"></label>
      <label class="field"><span>Price (${esc(cur)})</span><input id="wl-price" type="text" inputmode="decimal" placeholder="0" aria-label="Price"></label>
      <label class="field wl-wide"><span>Link or note (optional)</span><input id="wl-note" type="text" placeholder="https://… or a note" aria-label="Link or note"></label>
      <div class="btns"><button type="button" class="btn primary" data-act="wl-add">Add to the list</button><button type="button" class="btn" data-act="afford-open">Can I afford it?</button></div>
    </div>
  </section>
  <section class="card">
    <h2>Waiting <span class="right muted" data-testid="wl-total">${s.waiting.length ? `${s.waiting.length} item${s.waiting.length === 1 ? '' : 's'} · ${esc(whole(s.total))}` : ''}</span></h2>
    ${s.waiting.length ? `<div class="list">${s.waiting.map((it) => itemRow(it, today, s.wait, cur)).join('')}</div>` : Tips.EMPTY.wishlist()}
    <p class="wl-saved" data-testid="wl-saved"><b>Saved by waiting: ${esc(whole(s.saved))}</b>${s.removed.length ? ` <span class="muted">from ${s.removed.length} item${s.removed.length === 1 ? '' : 's'} you decided against</span>` : ''}</p>
  </section>
  ${s.bought.length ? `<section class="card"><h2>Bought</h2><div class="list">${s.bought.map((it) => `<div class="tx"><span class="t"><b>${esc(it.name)}</b><span>bought ${esc(shortDay(it.boughtAt))} · if you did not save the expense, put it back</span></span><span class="v">${esc(formatMoney(it.price, cur))}</span><button type="button" class="btn sm" data-act="wl-back" data-id="${esc(it.id)}">Put back</button></div>`).join('')}</div></section>` : ''}
  <section class="card"><h2>How long to wait</h2>
    <label class="field wl-wait"><span>Days before you can buy</span><input id="wl-days" type="number" min="0" max="90" step="1" value="${s.wait}" aria-label="Days to wait"></label>
    <p class="muted small" style="margin-bottom:0">It counts from the day an item was added, so a longer wait applies to items already on the list too.</p>
  </section>`;
}

function save() {
  ctx.persistSync();
  ctx.render();
}

export function onClick(act, el) {
  const { state } = ctx;
  const today = todayISO();
  if (act === 'wl-add') {
    const name = document.getElementById('wl-name')?.value.trim();
    const price = evalAmount(document.getElementById('wl-price')?.value);
    if (!name) { ctx.toast('What is it? Type a name.'); return true; }
    if (!price || price <= 0) { ctx.toast('Type a price, e.g. 1200'); return true; }
    addItem(state, { name, price, note: document.getElementById('wl-note')?.value || '' }, today);
    ctx.toast(`On the list. Ready in ${summaryWait()} days.`);
    save();
    return true;
  }
  if (act === 'wl-remove') {
    const it = removeItem(state, el.dataset.id, today);
    if (it) { ctx.toast(`Removed. You saved ${formatMoney(it.price, state.settings.currency)} by waiting.`); save(); }
    return true;
  }
  if (act === 'wl-buy') {
    const it = (state.settings.wishlist || []).find((x) => x.id === el.dataset.id);
    if (!it) return true;
    if (statusOf(it, today, summaryWait()) !== 'ready') { ctx.toast('Still waiting. Give it the full wait.'); return true; }
    buyItem(state, it.id, today);
    ctx.persistSync();
    // The normal new-expense sheet, filled in. The record is made only when you save it.
    ctx.openTxSheet(null, { type: 'expense', amountText: centsToPlain(it.price), note: it.name });
    return true;
  }
  if (act === 'wl-back') { putBack(state, el.dataset.id); save(); return true; }
  return Afford.onClick(act);
}

const summaryWait = () => summary(ctx.state).wait;

// The wait is a setting that travels with the data.
export function onChange(el) {
  if (el.id !== 'wl-days') return false;
  const n = Math.round(Number(el.value));
  if (!Number.isFinite(n) || n < 0 || n > 90) { ctx.toast('Between 0 and 90 days'); el.value = summaryWait(); return true; }
  ctx.state.settings.wishlistDays = n;
  ctx.state.settings.updatedAt = Date.now();
  save();
  return true;
}
