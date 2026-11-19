// Your own fields (#1), split records (#2) and colour tags (#5): the screens.
// app.js only calls these hooks:
//   the add/edit form   initDraft, tagRow, splitHTML, fieldsHTML, hidesCategory,
//                       read, check, apply, bind
//   the Log             rowChips, splitDetails (list), tableCols (Table), bulkHTML
//   Settings            fieldsCard, tagsCard (Categories & rules)
//   clicks              onClick (acts starting with "rx-")
// The pure parts are js/fields.js, js/splits.js and js/tags.js.

import { ctx, esc } from '../ctx.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import * as M from '../model.js';
import * as S from '../splits.js';
import * as F from '../fields.js';
import * as G from '../tags.js';
import * as IS from '../incomesources.js';

const COL_KEY = 'finance-helper.field-cols';
const TAGS_COL = '__tags';
const readCols = () => { try { const v = JSON.parse(localStorage.getItem(COL_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeCols = (v) => { try { localStorage.setItem(COL_KEY, JSON.stringify(v)); } catch { /* per device only */ } };
const catName = (id) => M.category(ctx.state, id)?.name || 'Other';
const catColor = (id) => (ctx.catColor ? ctx.catColor(id) : 'var(--c1)');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A coloured tag chip. */
export function tagChip(tag, { attrs = '', cls = '' } = {}) {
  const s = G.tagStyle(ctx.state, tag);
  return `<span class="rx-tag ${cls}" style="--tc:var(--c${s.color})" ${attrs}>#${esc(tag)}</span>`;
}

// ---------- The add/edit form ----------

const blankLine = (draft) => ({ amountText: '', category: draft.category || '', note: '', incomeSource: draft.incomeSource || '' });

/** Sets up the form's own state on the draft (field values, split lines). */
export function initDraft(draft, existing) {
  const { state } = ctx;
  draft.fieldVals = {};
  if (existing) {
    for (const d of F.fieldDefs(state, { all: true })) {
      const v = F.valueOf(existing, d.id);
      if (v !== undefined) draft.fieldVals[d.id] = d.type === 'bool' ? !!v : String(v);
    }
  } else {
    for (const k of ['expense', 'income', 'transfer']) {
      for (const [id, v] of Object.entries(F.defaultsFor(state, k))) if (!(id in draft.fieldVals)) draft.fieldVals[id] = typeof v === 'boolean' ? v : String(v);
    }
  }
  const lines = existing && Array.isArray(existing.splits) ? existing.splits : [];
  draft.splitOn = lines.length > 0;
  draft.lines = lines.map((l) => ({ amountText: Number.isInteger(l.amount) ? centsToPlain(l.amount) : '', category: l.category || '', note: l.note || '', incomeSource: l.incomeSource || '' }));
}

export const hidesCategory = (draft) => !!draft.splitOn && draft.type !== 'transfer';

/** The tag chips under the note: coloured, tap to add or take off; after a # in the note, the matching tags. */
export function tagRow(draft) {
  const { state } = ctx;
  const partial = (String(draft.note || '').match(/(?:^|\s)#([\p{L}\p{N}_-]*)$/u) || [])[1];
  const all = G.tagList(state);
  let chips;
  if (partial != null) {
    const hits = all.filter((g) => g.tag.startsWith(partial.toLowerCase()) && g.tag !== partial.toLowerCase()).slice(0, 10);
    chips = hits.map((g) => `<button type="button" class="rx-sug" data-rf="tag-sug" data-tag="${esc(g.tag)}" style="--tc:var(--c${g.color})">#${esc(g.tag)}</button>`).join('');
    return `<div class="tag-picks" id="rf-tags" role="group" aria-label="Tags" data-testid="rf-tags">${chips || ''}<span class="muted small">${chips ? 'Pick one, or keep typing' : partial ? `Space to make the new tag #${esc(partial)}` : 'Type the tag name'}</span></div>`;
  }
  const have = M.tagsOf(draft.note);
  const tags = all.slice(0, 8);
  for (const t of have) if (!tags.some((g) => g.tag === t)) tags.push({ tag: t, ...G.tagStyle(state, t) });
  chips = tags.map((g) => `<button type="button" class="tag-pick" data-tag="${esc(g.tag)}" aria-pressed="${have.includes(g.tag)}" style="--tc:var(--c${g.color})">#${esc(g.tag)}</button>`).join('');
  return `<div class="tag-picks" id="rf-tags" role="group" aria-label="Tags" data-testid="rf-tags">${chips}<span class="muted small">${tags.length ? 'Tap a tag, or' : 'Tags:'} type # in the note</span></div>`;
}

function leftLine(total, draft, cur) {
  const lines = (draft.lines || []).map((l) => ({ amount: evalAmount(l.amountText) || 0, category: l.category }));
  const r = S.checkSplit(total || 0, lines);
  if (!total) return { text: 'Type the total amount first', cls: 'muted' };
  if (r.left === 0) return { text: 'Adds up', cls: 'income' };
  if (r.left > 0) return { text: `${formatMoney(r.left, cur)} left to share`, cls: 'muted' };
  return { text: `${formatMoney(-r.left, cur)} too much`, cls: 'expense' };
}

/** The Split button, or the lines when split. `o`: { cats, cur, total, entryOn }. */
export function splitHTML(draft, o) {
  if (draft.type === 'transfer' || draft.loan) return '';
  if (!draft.splitOn) {
    return `<div class="rf-split-off"><button type="button" class="btn" data-rf="split-on" data-testid="rf-split">Split</button><span class="muted small">One amount across several categories</span></div>`;
  }
  const cats = o.cats || [];
  const opt = (sel) => {
    const list = cats.some((c) => c.id === sel) || !sel ? cats : [M.category(ctx.state, sel) || { id: sel, name: sel }, ...cats];
    return `${sel ? '' : '<option value="" selected>Category…</option>'}${list.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(`${c.emoji || ''} ${c.name}`.trim())}</option>`).join('')}`;
  };
  // Income lines can each have their own income source (js/incomesources.js), when you have any.
  const sources = draft.type === 'income' && !draft.refund ? IS.activeSources(ctx.state) : [];
  const src = sources.length > 0;
  const srcOpts = (sel) => `<option value="">No source</option>${[...sources, ...(sel && !sources.some((x) => x.id === sel) && IS.sourceById(ctx.state, sel) ? [IS.sourceById(ctx.state, sel)] : [])].map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(`${x.emoji || ''} ${x.name}`.trim())}</option>`).join('')}`;
  const left = leftLine(o.total, draft, o.cur);
  return `<div class="rf-split" data-testid="rf-split-box">
    <div class="rf-split-head"><b>Split into lines</b><span id="rf-left" class="small ${left.cls}" data-testid="rf-left" aria-live="polite">${esc(left.text)}</span>
      <button type="button" class="btn" data-rf="unsplit" data-testid="rf-unsplit">Unsplit</button></div>
    ${o.entryOn ? `<p class="muted small">Split works in the account's own currency (${esc(o.cur)}): pick it in the currency box.</p>` : ''}
    ${(draft.lines || []).map((l, i) => `<div class="rf-line" data-i="${i}">
      <input class="rf-amt" type="text" inputmode="decimal" autocomplete="off" value="${esc(l.amountText)}" placeholder="0" aria-label="Line ${i + 1} amount" data-testid="rf-amt">
      <select class="rf-cat" aria-label="Line ${i + 1} category" data-testid="rf-cat">${opt(l.category)}</select>
      <input class="rf-note" type="text" autocomplete="off" value="${esc(l.note)}" placeholder="Note or #tag (optional)" aria-label="Line ${i + 1} note">
      ${src ? `<select class="rf-src" aria-label="Line ${i + 1} income source">${srcOpts(l.incomeSource)}</select>` : ''}
      <button type="button" class="btn rf-rest" data-rf="rest" data-i="${i}" data-testid="rf-rest" title="This line takes what is left">Put the rest here</button>
      <button type="button" class="icon-btn" data-rf="del" data-i="${i}" aria-label="Remove line ${i + 1}">✕</button>
    </div>`).join('')}
    <button type="button" class="btn" data-rf="add" data-testid="rf-add">+ Line</button>
  </div>`;
}

function fieldInput(d, v) {
  const id = `rf-f-${esc(d.id)}`;
  const common = `id="${id}" data-rf-field="${esc(d.id)}" aria-label="${esc(d.name)}"`;
  if (d.type === 'bool') return `<label class="field check"><input type="checkbox" ${common} ${v === true ? 'checked' : ''}><span>${esc(d.name)}</span></label>`;
  let input;
  if (d.type === 'pick') {
    const opts = [...(d.options || [])];
    if (v && !opts.includes(v)) opts.push(v);
    input = `<select ${common}><option value="">—</option>${opts.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  } else if (d.type === 'date') input = `<input type="date" ${common} value="${esc(v ?? '')}">`;
  else if (d.type === 'number') input = `<input type="text" inputmode="decimal" autocomplete="off" ${common} value="${esc(v ?? '')}" placeholder="0">`;
  else input = `<input type="text" autocomplete="off" ${common} value="${esc(v ?? '')}">`;
  return `<label class="field"><span>${esc(d.name)}</span>${input}</label>`;
}

/** Your own fields for this kind of record. */
export function fieldsHTML(draft) {
  const defs = F.defsFor(ctx.state, draft.type);
  if (!defs.length) return '';
  return `<div class="rf-fields" data-testid="rf-fields">${defs.map((d) => fieldInput(d, draft.fieldVals?.[d.id])).join('')}</div>`;
}

/** Reads the form's own inputs into the draft (called from app.js readInputs). */
export function read(sheet, draft) {
  draft.fieldVals ||= {};
  for (const el of sheet.querySelectorAll('[data-rf-field]')) draft.fieldVals[el.dataset.rfField] = el.type === 'checkbox' ? el.checked : el.value;
  if (draft.splitOn && sheet.querySelector('.rf-split')) {
    draft.lines = [...sheet.querySelectorAll('.rf-line')].map((row) => ({
      amountText: row.querySelector('.rf-amt').value,
      category: row.querySelector('.rf-cat').value,
      note: row.querySelector('.rf-note').value,
      incomeSource: row.querySelector('.rf-src')?.value || '',
    }));
  }
}

/** Before saving: '' when fine, else what to fix. One empty line takes what is left. */
export function check(draft, total, { entryOn = false, cur = '' } = {}) {
  for (const d of F.defsFor(ctx.state, draft.type)) {
    const raw = draft.fieldVals?.[d.id];
    if (d.type === 'bool' || raw == null || raw === '') continue;
    if (!F.coerce(d, raw).ok) return `${d.name}: ${d.type === 'number' ? 'type a number' : d.type === 'date' ? 'pick a date' : 'pick one of the options'}`;
  }
  if (!draft.splitOn || draft.type === 'transfer') return '';
  if (draft.loan) return 'A loan can\'t be split: untick Lent / Borrowed or Unsplit';
  if (entryOn) return `Split works in the account's own currency (${cur}): pick it in the currency box`;
  const lines = draft.lines || [];
  const want = draft.type === 'income' && draft.refund ? 'expense' : draft.type;
  if (lines.some((l) => l.category && M.category(ctx.state, l.category)?.type !== want)) return `Pick ${want === 'income' ? 'an income' : 'a spending'} category for each line`;
  const used = lines.reduce((a, l) => a + (evalAmount(l.amountText) || 0), 0);
  const empty = lines.filter((l) => !(evalAmount(l.amountText) > 0));
  if (empty.length === 1 && total - used > 0) empty[0].amountText = centsToPlain(total - used);
  const r = S.checkSplit(total, lines.map((l) => ({ amount: evalAmount(l.amountText) || 0, category: l.category })));
  if (r.ok) return '';
  if (r.error === 'left') return `The lines must add up to ${formatMoney(total, cur)}: ${formatMoney(r.left, cur)} left to share`;
  if (r.error === 'over') return `The lines must add up to ${formatMoney(total, cur)}: ${formatMoney(-r.left, cur)} too much`;
  return r.error;
}

/** The record with the form's fields and lines (after app.js built it and kept the fields the form doesn't show). */
export function apply(tx, draft, existing) {
  let out = { ...tx };
  // Fields: what the form shows for this kind; every other value on the record stays.
  const fields = { ...(existing?.fields && typeof existing.fields === 'object' ? existing.fields : {}) };
  for (const d of F.defsFor(ctx.state, out.type)) {
    const raw = draft.fieldVals?.[d.id];
    const c = d.type === 'bool' ? { ok: true, value: raw === true ? true : existing && F.valueOf(existing, d.id) === false ? false : undefined } : F.coerce(d, raw);
    if (!c.ok) continue;
    if (c.value === undefined) delete fields[d.id]; else fields[d.id] = c.value;
  }
  if (Object.keys(fields).length) out.fields = fields; else delete out.fields;
  // Lines.
  if (draft.splitOn && S.canSplit(out)) {
    const src = out.type === 'income' && !out.refund;
    const lines = (draft.lines || []).map((l) => ({ amount: evalAmount(l.amountText) || 0, category: l.category, note: l.note, ...(src && l.incomeSource ? { incomeSource: l.incomeSource } : {}) })).filter((l) => l.amount > 0);
    const split = S.withSplits(out, lines);
    if (split) out = split; else delete out.splits;
  } else delete out.splits;
  return out;
}

function paintLeft(sheet, api) {
  const el = sheet.querySelector('#rf-left');
  if (!el) return;
  read(sheet, api.draft);
  const r = leftLine(api.total(), api.draft, api.cur());
  el.textContent = r.text;
  el.className = `small ${r.cls}`;
}

function paintTags(sheet, draft) {
  const box = sheet.querySelector('#rf-tags');
  const note = sheet.querySelector('#tx-note');
  if (!box || !note) return;
  draft.note = note.value;
  box.outerHTML = tagRow(draft);
}

/** Listeners for the form's own parts, bound once on the sheet. `api`: { draft, repaint, readAll, total, cur }. */
export function bind(sheet, api) {
  const { draft } = api;
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rf]');
    if (!b) return;
    const act = b.dataset.rf;
    const i = Number(b.dataset.i);
    if (act === 'tag-sug') {
      const note = sheet.querySelector('#tx-note');
      if (!note) return;
      note.value = `${note.value.replace(/#[\p{L}\p{N}_-]*$/u, `#${b.dataset.tag}`)} `;
      draft.note = note.value;
      paintTags(sheet, draft);
      note.focus();
      return;
    }
    api.readAll();
    if (act === 'split-on') {
      draft.splitOn = true;
      draft.lines = [blankLine(draft), blankLine(draft)];
      api.repaint();
      sheet.querySelector('.rf-amt')?.focus();
    } else if (act === 'unsplit') {
      const first = (draft.lines || []).find((l) => l.category);
      if (first) draft.category = first.category;
      draft.splitOn = false;
      draft.lines = [];
      api.repaint();
    } else if (act === 'add') {
      draft.lines.push(blankLine(draft));
      api.repaint();
      [...sheet.querySelectorAll('.rf-amt')].at(-1)?.focus();
    } else if (act === 'del') {
      draft.lines.splice(i, 1);
      while (draft.lines.length < 2) draft.lines.push(blankLine(draft));
      api.repaint();
    } else if (act === 'rest') {
      const others = draft.lines.reduce((a, l, k) => a + (k === i ? 0 : evalAmount(l.amountText) || 0), 0);
      const rest = api.total() - others;
      if (rest > 0) {
        draft.lines[i].amountText = centsToPlain(rest);
        const input = sheet.querySelectorAll('.rf-amt')[i];
        if (input) input.value = draft.lines[i].amountText;
      }
      paintLeft(sheet, api);
    }
  });
  sheet.addEventListener('input', (e) => {
    if (e.target.matches?.('.rf-amt, #tx-amount')) paintLeft(sheet, api);
    if (e.target.id === 'tx-note') paintTags(sheet, draft);
  });
}

// ---------- The Log ----------

/** Coloured tags, your field values and the split badge under a Log row's title. */
export function rowChips(t) {
  const { state } = ctx;
  const tags = G.recordTags(t);
  const vals = F.fieldDefs(state).map((d) => [d, F.display(d, F.valueOf(t, d.id))]).filter(([, v]) => v);
  const split = S.isSplit(t) ? `<span class="rx-chip rx-split-badge">Split · ${t.splits.length}</span>` : S.brokenSplit(t) ? '<span class="rx-chip rx-broken" title="The lines no longer add up to the amount: open the record to fix them">Lines don\'t add up</span>' : '';
  if (!tags.length && !vals.length && !split) return '';
  return `<span class="rx-chips">${split}${tags.map((g) => tagChip(g)).join('')}${vals.map(([d, v]) => `<span class="rx-chip" title="${esc(d.name)}">${esc(d.name)}: ${esc(v)}</span>`).join('')}</span>`;
}

/** The lines of a split record, under its Log row (open / close). */
export function splitDetails(t) {
  if (!S.isSplit(t)) return '';
  return `<details class="rx-lines" data-testid="rx-lines" data-id="${esc(t.id)}"><summary>${plural(t.splits.length, 'line')}</summary><ul>${t.splits.map((l) => `<li><span class="rx-dot" style="--c:${catColor(l.category)}"></span><span class="rx-l-name">${esc(catName(l.category))}${l.note ? ` <span class="muted">· ${esc(l.note)}</span>` : ''}</span><b>${formatMoney(l.amount, t.currency)}</b></li>`).join('')}</ul></details>`;
}

/** Extra Table columns you turned on (Settings → Custom fields): [{ label, cell(t) }]. */
export function tableCols() {
  const { state } = ctx;
  const shown = readCols();
  const cols = F.shownColumns(state, shown).map((d) => ({ label: d.name, cell: (t) => esc(F.display(d, F.valueOf(t, d.id))) }));
  if (shown.includes(TAGS_COL)) cols.push({ label: 'Tags', cell: (t) => G.recordTags(t).map((g) => tagChip(g)).join(' ') });
  return cols;
}

/** The Table's bulk bar: Set field…, Add tag…, Remove tag…. */
export function bulkHTML() {
  return `${F.fieldDefs(ctx.state).length ? '<button type="button" class="btn" data-act="rx-bulk-field" data-testid="bulk-field">Set field…</button>' : ''}
    <button type="button" class="btn" data-act="rx-bulk-tag" data-add="1" data-testid="bulk-tag-add">Add tag…</button>
    <button type="button" class="btn" data-act="rx-bulk-tag" data-add="0" data-testid="bulk-tag-remove">Remove tag…</button>`;
}

function selectedIds() { return [...(ctx.ui.selected || [])]; }

function openBulkField() {
  const { state } = ctx;
  const defs = F.fieldDefs(state);
  const ids = selectedIds();
  if (!defs.length || !ids.length) return;
  let cur = defs[0];
  const valueBox = (d) => {
    const attrs = 'id="rx-bf-val" aria-label="Value" data-testid="bulk-field-value"';
    if (d.type === 'bool') return `<label class="field"><span>Value</span><select ${attrs}><option value="yes">Yes</option><option value="no">No</option></select></label>`;
    if (d.type === 'pick') return `<label class="field"><span>Value</span><select ${attrs}>${(d.options || []).map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>`;
    return `<label class="field"><span>Value</span><input ${attrs} type="${d.type === 'date' ? 'date' : 'text'}" ${d.type === 'number' ? 'inputmode="decimal"' : ''} autocomplete="off"></label>`;
  };
  ctx.openSheet(`<h3>Set a field on ${plural(ids.length, 'record')} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <label class="field"><span>Field</span><select id="rx-bf-field" data-testid="bulk-field-pick">${defs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label>
    <div id="rx-bf-box">${valueBox(cur)}</div>
    <label class="field check"><input type="checkbox" id="rx-bf-clear"><span>Clear this field instead</span></label>
    <p class="small expense" id="rx-bf-err"></p>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" id="rx-bf-ok" data-testid="bulk-field-ok">Set</button></div>`, (sheet) => {
    sheet.querySelector('#rx-bf-field').addEventListener('change', (e) => { cur = F.fieldById(state, e.target.value); sheet.querySelector('#rx-bf-box').innerHTML = valueBox(cur); });
    sheet.querySelector('#rx-bf-ok').addEventListener('click', () => {
      const clear = sheet.querySelector('#rx-bf-clear').checked;
      const raw = sheet.querySelector('#rx-bf-val')?.value ?? '';
      const c = clear ? { ok: true, value: undefined } : F.coerce(cur, raw);
      if (!c.ok || (!clear && c.value === undefined)) { sheet.querySelector('#rx-bf-err').textContent = 'Type a value that fits this field'; return; }
      const set = new Set(ids);
      const kinds = Array.isArray(cur.kinds) && cur.kinds.length ? cur.kinds : ['expense', 'income'];
      let changed = 0;
      let skipped = 0;
      const now = Date.now();
      for (const t of state.tx) {
        if (!set.has(t.id)) continue;
        if (!kinds.includes(t.type)) { skipped++; continue; }
        if (F.setValue(t, cur.id, c.value)) { M.touch(t, now); changed++; }
      }
      ctx.closeSheet();
      if (!changed) { ctx.toast(skipped ? 'None of these records can take that field' : 'Nothing changed'); return; }
      ctx.commit();
      ctx.toast(`${clear ? 'Cleared' : 'Set'} ${cur.name} on ${plural(changed, 'record')}${skipped ? ` (${skipped} skipped)` : ''}`, 'Undo', () => ctx.undo());
    });
  });
}

function openBulkTag(add) {
  const { state } = ctx;
  const ids = selectedIds();
  if (!ids.length) return;
  const tags = G.tagList(state);
  ctx.openSheet(`<h3>${add ? 'Add a tag to' : 'Take a tag off'} ${plural(ids.length, 'record')} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <label class="field"><span>Tag</span><input id="rx-bt" type="text" list="rx-bt-list" autocomplete="off" placeholder="trip" data-testid="bulk-tag-input"></label>
    <datalist id="rx-bt-list">${tags.map((g) => `<option value="${esc(g.tag)}">`).join('')}</datalist>
    <div class="rx-chiprow">${tags.slice(0, 12).map((g) => tagChip(g.tag, { attrs: `data-pick="${esc(g.tag)}" role="button" tabindex="0"` })).join('')}</div>
    <p class="small expense" id="rx-bt-err"></p>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" id="rx-bt-ok" data-testid="bulk-tag-ok">${add ? 'Add tag' : 'Take off'}</button></div>`, (sheet) => {
    const input = sheet.querySelector('#rx-bt');
    sheet.addEventListener('click', (e) => { const p = e.target.closest('[data-pick]'); if (p) input.value = p.dataset.pick; });
    sheet.querySelector('#rx-bt-ok').addEventListener('click', () => {
      const g = G.normTag(input.value);
      if (!g) { sheet.querySelector('#rx-bt-err').textContent = 'A tag is one word: letters, numbers, - or _'; return; }
      const r = G.bulkTag(state, ids, g, add);
      ctx.closeSheet();
      if (!r.changed) { ctx.toast(add ? `They all have #${g} already` : `None of them has #${g}`); return; }
      ctx.commit();
      ctx.toast(`${add ? 'Added' : 'Took off'} #${g} ${add ? 'to' : 'from'} ${plural(r.changed, 'record')}`, 'Undo', () => ctx.undo());
    });
    input.focus();
  });
}

// ---------- Settings → Categories & rules ----------

const kindNames = (d) => (Array.isArray(d.kinds) && d.kinds.length ? d.kinds : ['expense', 'income']).map((k) => F.KINDS.find((x) => x.id === k)?.name || k).join(', ');
const typeName = (t) => F.FIELD_TYPES.find((x) => x.id === t)?.name || t;

export function fieldsCard() {
  const { state } = ctx;
  const all = F.fieldDefs(state, { all: true });
  const live = all.filter((d) => !d.archived);
  const old = all.filter((d) => d.archived);
  const cols = readCols();
  const row = (d) => `<div class="rx-frow" data-testid="field-row" data-field="${esc(d.id)}">
    <div><b>${esc(d.name)}</b><div class="muted small">${esc(typeName(d.type))}${d.type === 'pick' ? `: ${esc((d.options || []).join(', '))}` : ''} · ${esc(kindNames(d))}${d.def !== undefined ? ` · default ${esc(F.display(d, d.def))}` : ''} · ${plural(F.usedBy(state, d.id), 'record')}</div></div>
    <label class="cat-bill" title="Show as a column in Log → Table (this device)"><input type="checkbox" data-act="rx-col" data-id="${esc(d.id)}" ${cols.includes(d.id) ? 'checked' : ''}><span>Log column</span></label>
    <button type="button" class="btn" data-act="rx-field-edit" data-id="${esc(d.id)}">Edit</button>
    <button type="button" class="btn" data-act="rx-field-archive" data-id="${esc(d.id)}" title="Hidden from the form; values on records are kept">Archive</button>
  </div>`;
  return `<section class="card" id="rx-fields-card" data-testid="fields-card"><h2>Custom fields</h2>
    <p class="muted small" style="margin-top:0">Your own fields on records, like Project, Client or Receipt no. They show in the add/edit form, can be Log columns, searched as <code>project:website</code>, set on many records at once, and go into the export.</p>
    ${live.map(row).join('') || '<p class="muted small">No fields yet.</p>'}
    <label class="cat-bill"><input type="checkbox" data-act="rx-col" data-id="${TAGS_COL}" ${cols.includes(TAGS_COL) ? 'checked' : ''}><span>Show tags as a Log column</span></label>
    <div class="btns" style="justify-content:flex-start"><button type="button" class="btn primary" data-act="rx-field-new" data-testid="field-new">+ Add a field</button></div>
    ${old.length ? `<details class="rx-old"><summary class="muted small">Archived (${old.length})</summary>${old.map((d) => `<div class="rx-frow"><div><b>${esc(d.name)}</b><div class="muted small">${plural(F.usedBy(state, d.id), 'record')} keep their value</div></div><button type="button" class="btn" data-act="rx-field-unarchive" data-id="${esc(d.id)}">Bring back</button></div>`).join('')}</details>` : ''}
  </section>`;
}

function openFieldEditor(id = null) {
  const { state } = ctx;
  const cur = id ? F.fieldById(state, id) : null;
  const d = cur ? { ...cur, options: [...(cur.options || [])] } : { name: '', type: 'text', kinds: ['expense', 'income'], options: [] };
  const paint = (sheet) => {
    sheet.innerHTML = `<div class="grab"></div><h3>${cur ? `Edit ${esc(cur.name)}` : 'New field'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
      <label class="field"><span>Name</span><input id="rx-fe-name" type="text" maxlength="30" value="${esc(d.name)}" placeholder="Project" data-testid="field-name"></label>
      <label class="field"><span>Type</span><select id="rx-fe-type" data-testid="field-type">${F.FIELD_TYPES.map((x) => `<option value="${x.id}" ${x.id === d.type ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
      ${d.type === 'pick' ? `<label class="field"><span>Options (one per line or comma)</span><textarea id="rx-fe-opts" rows="3" data-testid="field-options">${esc((d.options || []).join('\n'))}</textarea></label>` : ''}
      <fieldset class="rx-kinds"><legend class="muted small">For</legend>${F.KINDS.map((k) => `<label class="cat-bill"><input type="checkbox" class="rx-fe-kind" value="${k.id}" ${(d.kinds || []).includes(k.id) ? 'checked' : ''}><span>${k.name}</span></label>`).join('')}</fieldset>
      <label class="field"><span>Default for new records (optional)</span><input id="rx-fe-def" type="${d.type === 'date' ? 'date' : 'text'}" value="${esc(d.def === undefined ? '' : d.type === 'bool' ? (d.def ? 'yes' : 'no') : d.def)}" placeholder="${d.type === 'bool' ? 'yes or no' : d.type === 'pick' ? 'one of the options' : ''}"></label>
      <p class="small expense" id="rx-fe-err" data-testid="field-error"></p>
      <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" id="rx-fe-ok" data-testid="field-save">${cur ? 'Save' : 'Add field'}</button></div>`;
  };
  const readForm = (sheet) => {
    d.name = sheet.querySelector('#rx-fe-name').value;
    d.type = sheet.querySelector('#rx-fe-type').value;
    const o = sheet.querySelector('#rx-fe-opts');
    if (o) d.options = F.cleanOptions(o.value);
    d.kinds = [...sheet.querySelectorAll('.rx-fe-kind')].filter((x) => x.checked).map((x) => x.value);
    d.def = sheet.querySelector('#rx-fe-def').value;
  };
  ctx.openSheet('', (sheet) => {
    paint(sheet);
    sheet.addEventListener('change', (e) => { if (e.target.id === 'rx-fe-type') { readForm(sheet); d.def = ''; paint(sheet); } });
    sheet.addEventListener('click', (e) => {
      if (!e.target.closest('#rx-fe-ok')) return;
      readForm(sheet);
      const r = cur ? F.updateField(state, cur.id, d) : F.addField(state, d);
      if (r.error) { sheet.querySelector('#rx-fe-err').textContent = r.error; return; }
      ctx.closeSheet();
      ctx.commit();
      ctx.toast(cur ? `Saved ${r.def.name}` : `Added the field ${r.def.name}`);
    });
    sheet.querySelector('#rx-fe-name').focus();
  });
}

export function tagsCard() {
  const { state } = ctx;
  const list = G.tagList(state, { archived: true });
  const row = (g) => `<div class="rx-trow${g.archived ? ' is-archived' : ''}" data-testid="tag-row" data-tag="${esc(g.tag)}">
    ${tagChip(g.tag)} <span class="muted small">${plural(g.count, 'record')}${g.archived ? ' · archived' : ''}</span>
    <span class="rx-swatches" role="group" aria-label="Colour of #${esc(g.tag)}">${Array.from({ length: G.COLORS }, (_, i) => `<button type="button" class="rx-sw" style="--tc:var(--c${i + 1})" data-act="rx-tag-color" data-tag="${esc(g.tag)}" data-color="${i + 1}" aria-pressed="${g.color === i + 1}" aria-label="Colour ${i + 1}"></button>`).join('')}</span>
    <button type="button" class="btn" data-act="rx-tag-merge" data-tag="${esc(g.tag)}" data-testid="tag-merge">Rename or merge…</button>
    <button type="button" class="btn" data-act="rx-tag-archive" data-tag="${esc(g.tag)}">${g.archived ? 'Bring back' : 'Archive'}</button>
  </div>`;
  return `<section class="card" id="rx-tags-card" data-testid="tags-card"><h2>Tags <a class="card-link right" href="#tags">Reports → Tags</a></h2>
    <p class="muted small" style="margin-top:0">A tag is a #word in a record's note (#trip, #gift). Give each a colour; archived tags are left out of the form's chips. Merging rewrites the notes (one Undo).</p>
    ${list.map(row).join('') || '<p class="muted small">No tags yet: type #trip in a record\'s note.</p>'}
    <div class="rx-newtag"><input id="rx-tag-new" type="text" placeholder="New tag, e.g. trip" aria-label="New tag name" data-testid="tag-new"><button type="button" class="btn" data-act="rx-tag-add" data-testid="tag-add">Add tag</button></div>
  </section>`;
}

function openMerge(from) {
  const { state } = ctx;
  const others = G.tagList(state, { archived: true }).filter((g) => g.tag !== from);
  ctx.openSheet(`<h3>Rename or merge #${esc(from)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small">Every note with #${esc(from)} gets the new tag instead. Pick another tag to merge into it, or type a new name to rename.</p>
    <label class="field"><span>Into</span><input id="rx-mg" type="text" list="rx-mg-list" autocomplete="off" data-testid="tag-merge-into"></label>
    <datalist id="rx-mg-list">${others.map((g) => `<option value="${esc(g.tag)}">`).join('')}</datalist>
    <p class="small expense" id="rx-mg-err"></p>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" id="rx-mg-ok" data-testid="tag-merge-ok">Merge</button></div>`, (sheet) => {
    const input = sheet.querySelector('#rx-mg');
    sheet.querySelector('#rx-mg-ok').addEventListener('click', () => {
      const to = G.normTag(input.value);
      if (!to || to === from) { sheet.querySelector('#rx-mg-err').textContent = 'Type another tag name (one word)'; return; }
      // The new name takes the old colour when it has none of its own.
      if (!state.settings.tagStyles?.[to] && state.settings.tagStyles?.[from]) G.setTagStyle(state, to, { color: G.tagStyle(state, from).color });
      const n = G.mergeTags(state, from, to);
      ctx.closeSheet();
      ctx.commit();
      ctx.toast(`#${from} is now #${to} on ${plural(n, 'record')}`, 'Undo', () => ctx.undo());
    });
    input.focus();
  });
}

/** Clicks with an "rx-" act. Returns true when handled. */
export function onClick(act, el) {
  if (!act || !act.startsWith('rx-')) return false;
  const { state } = ctx;
  if (act === 'rx-bulk-field') openBulkField();
  else if (act === 'rx-bulk-tag') openBulkTag(el.dataset.add === '1');
  else if (act === 'rx-field-new') openFieldEditor();
  else if (act === 'rx-field-edit') openFieldEditor(el.dataset.id);
  else if (act === 'rx-field-archive' || act === 'rx-field-unarchive') {
    F.archiveField(state, el.dataset.id, act === 'rx-field-archive');
    ctx.commit();
    ctx.toast(act === 'rx-field-archive' ? 'Archived. Values on records are kept.' : 'Back in the form');
  } else if (act === 'rx-col') {
    const id = el.dataset.id;
    const cols = readCols().filter((x) => x !== id);
    if (el.checked) cols.push(id);
    writeCols(cols);
  } else if (act === 'rx-tag-color') {
    G.setTagStyle(state, el.dataset.tag, { color: Number(el.dataset.color) });
    ctx.commit();
  } else if (act === 'rx-tag-archive') {
    G.setTagStyle(state, el.dataset.tag, { archived: !G.tagStyle(state, el.dataset.tag).archived });
    ctx.commit();
  } else if (act === 'rx-tag-merge') openMerge(el.dataset.tag);
  else if (act === 'rx-tag-add') {
    const input = document.getElementById('rx-tag-new');
    const g = G.normTag(input?.value);
    if (!g) { ctx.toast('A tag is one word: letters, numbers, - or _'); return true; }
    G.setTagStyle(state, g, {});
    ctx.commit();
    ctx.toast(`Added #${g}`);
  } else return false;
  return true;
}
