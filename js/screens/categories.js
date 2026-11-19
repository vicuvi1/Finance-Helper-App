// Subcategories: the editor in Settings → Categories (add, rename, change the
// icon, move to another category, remove) and the "Needs a subcategory"
// helper, which files older records one tap at a time with a guess from
// their note. The logic lives in js/cattree.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as T from '../cattree.js';
import { formatMoney } from '../money.js';

const SHOW = 60; // records shown at once in the helper

// A category's icon: its emoji, else a coloured dot.
export const catIcon = (c) => (c?.emoji ? `<span class="ci" aria-hidden="true">${esc(c.emoji)}</span>` : ctx.dot(ctx.catColor(c?.id)));
// A subcategory's colour: the one you picked, else the first one shares its
// category's colour and the next ones step through the palette, so they
// stay apart in charts.
export function subColor(state, s) {
  if (!s) return 'var(--faint)';
  if (s.color >= 1 && s.color <= 8) return `var(--c${s.color})`;
  const pi = Math.max(0, state.settings.categories.findIndex((c) => c.id === s.parent));
  const i = Math.max(0, T.subsOf(state, s.parent).findIndex((x) => x.id === s.id));
  return `var(--c${((pi + i * 3) % 8) + 1})`;
}

const expenseCats = (state) => state.settings.categories.filter((c) => c.type === 'expense' && !c.archived);

// ---------- Settings: the editor ----------

export function editorCard() {
  const { state } = ctx;
  const used = new Map();
  for (const t of state.tx) if (t.sub) used.set(t.sub, (used.get(t.sub) || 0) + 1);
  const waiting = state.tx.filter((t) => T.needsSub(state, t)).length;
  const parentOptions = (sel) => expenseCats(state).map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(`${c.emoji || ''} ${c.name}`.trim())}</option>`).join('');
  const group = (c) => {
    const subs = T.subsOf(state, c.id);
    return `<div class="sce-group" style="--c:${ctx.catColor(c.id)}">
      <div class="sce-head">${catIcon(c)}<b>${esc(c.name)}</b><span class="muted small">${subs.length ? `${subs.length} subcategor${subs.length === 1 ? 'y' : 'ies'}` : 'no subcategories yet'}</span></div>
      ${subs.map((s) => `<div class="sce-row">
        <button type="button" class="sce-swatch" data-act="sub-color" data-id="${esc(s.id)}" style="--c:${subColor(state, s)}" aria-label="Colour of ${esc(s.name)}${s.color ? '' : ' (automatic)'}: tap to change" title="Tap to change the colour"></button>
        <input class="sce-emoji" type="text" value="${esc(s.emoji || '')}" maxlength="4" data-sub="${esc(s.id)}" data-field="emoji" aria-label="Icon for ${esc(s.name)}" placeholder="•">
        <input class="sce-name" type="text" value="${esc(s.name)}" data-sub="${esc(s.id)}" data-field="name" aria-label="Name">
        <select class="sce-move" data-sub="${esc(s.id)}" data-field="parent" aria-label="Move ${esc(s.name)} to another category" title="Move to another category (its records go along)">${parentOptions(c.id)}</select>
        <span class="sce-count muted small" title="Records in it">${used.get(s.id) || 0}</span>
        <button type="button" class="icon-btn sce-del" data-act="sub-del" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.name)}" title="Remove (its records stay in ${esc(c.name)})">✕</button>
      </div>`).join('')}
      <div class="sce-row sce-new"><span></span><input class="sce-emoji" type="text" maxlength="4" placeholder="＋" id="sce-new-emoji-${esc(c.id)}" aria-label="Icon for a new subcategory">
        <input class="sce-name" type="text" placeholder="New subcategory in ${esc(c.name)}" id="sce-new-${esc(c.id)}" data-new-sub="${esc(c.id)}" aria-label="New subcategory in ${esc(c.name)}">
        <button type="button" class="btn small" data-act="sub-add" data-parent="${esc(c.id)}">Add</button></div>
    </div>`;
  };
  return `<section class="card" id="subcats-card"><h2>Subcategories ${waiting ? `<button class="card-link right" data-act="needs-sub-open">${waiting} need${waiting === 1 ? 's' : ''} a subcategory</button>` : ''}</h2>
    <p class="muted small" style="margin-top:0">One level deeper, so Reports can show where the money really goes (Food › Cafés & coffee). Change an icon or a name, move one to another category (its records go along), or remove it (its records stay in the category). New records get a subcategory from their note; when you change it, the app remembers that shop.</p>
    <div class="sce-groups">${expenseCats(state).map(group).join('')}</div>
  </section>`;
}

const refresh = () => {
  const el = document.getElementById('subcats-card');
  if (el) el.outerHTML = editorCard();
};

function addFrom(parent) {
  const name = document.getElementById(`sce-new-${parent}`)?.value;
  const emoji = document.getElementById(`sce-new-emoji-${parent}`)?.value;
  const s = T.addSub(ctx.state, parent, name, emoji);
  if (!s) { ctx.toast('Type a name first'); return; }
  ctx.persistSync();
  refresh();
  document.getElementById(`sce-new-${parent}`)?.focus();
  ctx.toast(`Added ${s.name}`);
}

// ---------- The helper ----------

function guessRow(state, x) {
  const { t, guess } = x;
  const c = M.category(state, t.category);
  const opts = (T.isOther(t.category) ? expenseCats(state) : [c]).filter(Boolean)
    .map((p) => {
      const subs = T.subsOf(state, p.id);
      return subs.length ? `<optgroup label="${esc(`${p.emoji || ''} ${p.name}`.trim())}">${subs.map((s) => `<option value="${esc(s.id)}">${esc(`${s.emoji || ''} ${s.name}`.trim())}</option>`).join('')}</optgroup>` : '';
    }).join('');
  return `<div class="ns-row" data-id="${esc(t.id)}">
    <div class="ns-main"><b>${esc(t.note || c?.name || 'No note')}</b><span class="muted small">${esc(t.date)} · ${esc(c?.name || 'Other')} · ${esc(formatMoney(t.amount, t.currency || state.settings.currency))}</span></div>
    <div class="ns-acts">
      ${guess ? `<button type="button" class="guess-chip" data-act="ns-yes" data-id="${esc(t.id)}" data-sub="${esc(guess.id)}" title="File it there">Is this ${esc(guess.emoji || '')} ${T.isOther(t.category) ? `${esc(M.category(state, guess.parent)?.name || '')} › ` : ''}${esc(guess.name)}? <b>✓</b></button>` : '<span class="muted small">No guess</span>'}
      <select class="ns-pick" data-ns="${esc(t.id)}" aria-label="Pick a subcategory for ${esc(t.note || 'this record')}"><option value="">${guess ? 'Change…' : 'Pick…'}</option>${opts}</select>
    </div>
  </div>`;
}

export function openNeedsSub(list = null) {
  const paint = (sheet) => {
    const { state } = ctx;
    const all = T.needsSubList(state, list || state.tx);
    const guessed = all.filter((x) => x.guess);
    sheet.innerHTML = `<div class="grab"></div><h3>Needs a subcategory <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      ${all.length ? `<p class="muted small" style="margin-top:0">${all.length} spending record${all.length === 1 ? '' : 's'} without a subcategory${guessed.length ? `, ${guessed.length} with a guess from the note` : ''}. Tap ✓ when the guess is right, or pick another one: the app remembers the shop for next time.</p>
      ${guessed.length > 1 ? `<div class="btns" style="margin-bottom:10px"><button type="button" class="btn primary" data-act="ns-all">File all ${guessed.length} guesses</button></div>` : ''}
      <div class="ns-list">${all.slice(0, SHOW).map((x) => guessRow(state, x)).join('')}</div>
      ${all.length > SHOW ? `<p class="muted small">…and ${all.length - SHOW} more. They show up here as you file these.</p>` : ''}`
      : '<p class="muted">Everything has a subcategory. Nice and tidy.</p>'}`;
  };
  ctx.openSheet('', (sheet) => {
    paint(sheet);
    const file = (id, subId) => {
      const t = ctx.state.tx.find((x) => x.id === id);
      if (!t || !T.setSub(ctx.state, t, subId)) return;
      ctx.persistSync();
      const row = sheet.querySelector(`.ns-row[data-id="${CSS.escape(id)}"]`);
      row?.classList.add('ns-done');
      ctx.render();
      setTimeout(() => paint(sheet), 180);
    };
    sheet.addEventListener('click', (e) => {
      const yes = e.target.closest('[data-act="ns-yes"]');
      if (yes) { file(yes.dataset.id, yes.dataset.sub); return; }
      if (e.target.closest('[data-act="ns-all"]')) {
        const all = T.needsSubList(ctx.state, list || ctx.state.tx).filter((x) => x.guess);
        for (const x of all) T.setSub(ctx.state, x.t, x.guess.id, { learn: false });
        ctx.persistSync();
        ctx.render();
        paint(sheet);
        ctx.toast(`${all.length} record${all.length === 1 ? '' : 's'} filed`);
      }
    });
    sheet.addEventListener('change', (e) => {
      const sel = e.target.closest('.ns-pick');
      if (sel?.value) file(sel.dataset.ns, sel.value);
    });
  });
}

// ---------- Events (Settings screen) ----------

export function onClick(act, el) {
  if (act === 'sub-add') { addFrom(el.dataset.parent); return true; }
  if (act === 'sub-del') {
    const s = T.subById(ctx.state, el.dataset.id);
    if (!s) return true;
    const n = T.removeSub(ctx.state, s.id);
    ctx.persistSync();
    refresh();
    ctx.toast(`Removed ${s.name}${n ? `. ${n} record${n === 1 ? '' : 's'} stay in ${M.category(ctx.state, s.parent)?.name || 'its category'}.` : ''}`);
    return true;
  }
  if (act === 'needs-sub-open') { openNeedsSub(); return true; }
  if (act === 'sub-color') {
    // Automatic, then the 8 colours, then back to automatic.
    const s = T.subById(ctx.state, el.dataset.id);
    if (!s) return true;
    const next = !s.color ? 1 : s.color >= 8 ? null : s.color + 1;
    T.renameSub(ctx.state, s.id, { color: next });
    ctx.persistSync();
    el.style.setProperty('--c', subColor(ctx.state, s));
    return true;
  }
  return false;
}

export function onChange(el) {
  if (el.dataset.sub && el.dataset.field) {
    const { state } = ctx;
    if (el.dataset.field === 'parent') {
      const s = T.subById(state, el.dataset.sub);
      const n = T.moveSub(state, el.dataset.sub, el.value);
      ctx.persistSync();
      refresh();
      ctx.toast(`${s?.name || 'Subcategory'} moved to ${M.category(state, el.value)?.name}${n ? ` with ${n} record${n === 1 ? '' : 's'}` : ''}`);
    } else {
      T.renameSub(state, el.dataset.sub, { [el.dataset.field]: el.value });
      ctx.persistSync();
    }
    return true;
  }
  return false;
}

// Enter in a "new subcategory" box adds it.
export function onKey(e) {
  const box = e.target.closest?.('[data-new-sub]');
  if (box && e.key === 'Enter') { e.preventDefault(); addFrom(box.dataset.newSub); return true; }
  return false;
}
