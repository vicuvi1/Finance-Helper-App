// Settings → Telegram buttons: the blocks under the bot's message box
// ("☕ Coffee 20"). Tap one to edit it (emoji, name, amount, category,
// account), arrows to reorder. The model is js/blocks.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as B from '../blocks.js';
import { evalAmount, formatMoney } from '../money.js';
import { pushKeyboard } from './telegram.js';

const plain = (c) => String(c / 100).replace('.', ',');

export function settingsCard() {
  const list = B.blocks(ctx.state);
  return `<section class="card" id="tgb-card"><h2>Telegram buttons <button class="right btn" data-act="tgb-add">+ Button</button></h2>
    <p class="muted small" style="margin-top:0">One tap in Telegram logs it for that day. They work with your PC off too: Telegram keeps the taps and the app logs them when it opens.</p>
    <div class="tgb-grid">${list.map((b, i) => `<div class="tgb">
      <button type="button" class="tgb-main" data-act="tgb-edit" data-id="${esc(b.id)}" title="Edit">
        <span class="tgb-emoji" aria-hidden="true">${esc(b.emoji || '•')}</span>
        <span class="tgb-name">${esc(b.name)}</span>
        <b class="${b.type === 'income' ? 'income' : ''}">${b.type === 'income' ? '+' : ''}${esc(formatMoney(b.amount, ctx.state.settings.currency, { compact: true }))}</b>
        <small class="muted">${esc(M.category(ctx.state, b.category)?.name || 'Other')}</small>
      </button>
      <span class="tgb-move">
        <button type="button" class="icon-btn" data-act="tgb-up" data-id="${esc(b.id)}" aria-label="Move ${esc(b.name)} left" ${i ? '' : 'disabled'}>‹</button>
        <button type="button" class="icon-btn" data-act="tgb-down" data-id="${esc(b.id)}" aria-label="Move ${esc(b.name)} right" ${i < list.length - 1 ? '' : 'disabled'}>›</button>
      </span>
    </div>`).join('')}</div>
    ${list.length ? '' : '<p class="muted">No buttons. Add your usual things: coffee, lunch, bus…</p>'}
  </section>`;
}

function changed() {
  ctx.commit();
  pushKeyboard();
}

function openBlock(id) {
  const { state } = ctx;
  const existing = id ? B.blocks(state).find((b) => b.id === id) : null;
  const b = existing ? { ...existing } : { id: `b-${Date.now().toString(36)}`, emoji: '☕', name: '', amount: 0, type: 'expense', category: 'food', account: null };
  const cats = (type) => state.settings.categories.filter((c) => c.type === type);
  const accs = M.activeAccounts(state);
  const html = () => `<h3>${existing ? 'Edit button' : 'New button'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="tgb-preview"><span>${esc(B.blockLabel({ ...b, name: b.name || 'Name', amount: b.amount || 0 }))}</span><small class="muted">how it looks in Telegram</small></div>
    <div class="seg" role="group" aria-label="Type"><button type="button" data-type="expense" aria-pressed="${b.type === 'expense'}">Spent</button><button type="button" data-type="income" aria-pressed="${b.type === 'income'}">Earned</button></div>
    <div class="field"><span>Emoji</span><div class="tgb-emojis" role="group" aria-label="Emoji">${B.EMOJIS.map((e) => `<button type="button" class="tgb-e" data-emoji="${e}" aria-pressed="${b.emoji === e}">${e}</button>`).join('')}
      <input id="tgb-emoji" type="text" value="${esc(b.emoji)}" maxlength="8" aria-label="Or type any emoji" placeholder="any"></div></div>
    <div class="row2">
      <label class="field"><span>Name</span><input id="tgb-name" type="text" value="${esc(b.name)}" placeholder="e.g. Coffee" autocomplete="off"></label>
      <label class="field"><span>Amount (${esc(state.settings.currency)})</span><input id="tgb-amount" type="text" inputmode="decimal" value="${b.amount ? plain(b.amount) : ''}" placeholder="20"></label>
    </div>
    <div class="row2">
      <label class="field"><span>Category</span><select id="tgb-cat">${cats(b.type).map((c) => `<option value="${esc(c.id)}" ${c.id === b.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field"><span>${b.type === 'income' ? 'Into' : 'Paid from'}</span><select id="tgb-acc"><option value="">The one I used last</option>${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === b.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    </div>
    <p class="lock-msg" id="tgb-err" hidden></p>
    <div class="btns"><button type="button" class="btn primary" data-b="save">${existing ? 'Save' : 'Add button'}</button>${existing ? '<button type="button" class="btn danger" data-b="delete">Delete</button>' : ''}</div>`;

  ctx.openSheet(html(), (sheet) => {
    // Keep what was typed when the sheet redraws (type or emoji change).
    const read = () => {
      b.name = sheet.querySelector('#tgb-name').value.trim();
      const a = evalAmount(sheet.querySelector('#tgb-amount').value);
      b.amount = a && a > 0 ? a : 0;
      b.category = sheet.querySelector('#tgb-cat').value;
      b.account = sheet.querySelector('#tgb-acc').value || null;
      b.emoji = sheet.querySelector('#tgb-emoji').value.trim();
    };
    const redraw = () => { sheet.innerHTML = `<div class="grab"></div>${html()}`; };
    sheet.addEventListener('input', (e) => {
      if (['tgb-name', 'tgb-amount', 'tgb-emoji'].includes(e.target.id)) {
        read();
        sheet.querySelector('.tgb-preview span').textContent = B.blockLabel({ ...b, name: b.name || 'Name' });
      }
    });
    sheet.addEventListener('click', (e) => {
      const em = e.target.closest('[data-emoji]');
      if (em) { read(); b.emoji = em.dataset.emoji; redraw(); return; }
      const ty = e.target.closest('[data-type]');
      if (ty) {
        read();
        b.type = ty.dataset.type;
        if (!cats(b.type).some((c) => c.id === b.category)) b.category = cats(b.type)[0]?.id || 'other';
        redraw();
        return;
      }
      const act = e.target.closest('[data-b]')?.dataset.b;
      if (act === 'save') {
        read();
        const err = sheet.querySelector('#tgb-err');
        if (!b.name || !b.amount) { err.hidden = false; err.textContent = 'Give it a name and an amount.'; return; }
        B.upsertBlock(state, b);
        ctx.closeSheet();
        changed();
        ctx.toast(existing ? 'Button saved' : `Added ${B.blockLabel(b)}`);
      } else if (act === 'delete') {
        B.removeBlock(state, b.id);
        ctx.closeSheet();
        changed();
        ctx.toast(`${b.name} removed`, 'Undo', () => ctx.undo?.());
      }
    });
  });
}

export function onClick(act, el) {
  if (act === 'tgb-add') { openBlock(null); return true; }
  if (act === 'tgb-edit') { openBlock(el.dataset.id); return true; }
  if (act === 'tgb-up' || act === 'tgb-down') {
    B.moveBlock(ctx.state, el.dataset.id, act === 'tgb-up' ? -1 : 1);
    changed();
    return true;
  }
  return false;
}
