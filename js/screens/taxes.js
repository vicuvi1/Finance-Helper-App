// Taxes (#taxes, a tab under Reports): the year's tax-tagged records, a
// rough estimate for the chosen situation, the accountant export, tagging
// (categories, single records, many at once) and the numbers it uses.
// Also the small "Tax tag" and "Receipts" row in a record's edit sheet and
// the "Tax tag…" choice in the Log table's bulk bar.
// Every view says plainly: "Not tax advice: check with an accountant."

import { ctx, esc } from '../ctx.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { todayISO, monthLabel, dayLabel } from '../dates.js';
import { workbook } from '../xlsx.js';
import { category } from '../model.js';
import { TAX_TAGS, tagLabel, tagsFor, tagFits, taxTagOf, tagSource, taggable, setTaxTag, setCategoryTag, taxYear, setProfile, setOverride, profileFor, bpText, bookName, inCurrency } from '../tax.js';
import { PROFILES, PROFILE_IDS, FIELDS } from '../taxprofiles.js';
import { accountantSheets, accountantFileName, NOT_ADVICE } from '../accountant.js';
import * as R from '../receipts.js';

const SHOW_CUR = ['MDL', 'USD', 'EUR'];
const CUR_KEY = 'finance-helper.tax-cur';
let year = null;
let filter = 'untagged';
const selected = new Set();
let showCur = (() => { try { return localStorage.getItem(CUR_KEY) || ''; } catch { return ''; } })();
const curYear = () => year || Number(todayISO().slice(0, 4));

// Re-draw when Life tells us about receipts (an upload finished).
R.onIndex(() => { if (ctx.ui?.tab === 'taxes') ctx.render?.(); });

const notAdvice = (p) => `<p class="tax-advice" data-testid="tax-not-advice"><b>${NOT_ADVICE}</b> ${p ? `Numbers for “${esc(p.label)}”${p.sources.length ? ` from ${esc(p.sources.join('; '))}` : ''}, checked ${esc(p.checked)}. Every number below can be changed.` : ''}</p>`;

export function view() {
  const { state } = ctx;
  const base = state.settings.currency || 'MDL';
  const y = curYear();
  const t = taxYear(state, y);
  const p = t.profile;
  const cur = SHOW_CUR.includes(showCur) && showCur !== base ? showCur : base;
  const shown = (c) => {
    const v = inCurrency(state, c, cur);
    return v == null ? `<span class="muted">no ${esc(cur)} rate</span>` : formatMoney(Math.round(v / 100) * 100, cur);
  };
  const exact = (c) => ctx.money(c);
  const today = todayISO();
  const pending = R.inLife() ? R.notInDrive(state, R.receiptIndex()) : 0;
  const est = t.estimate;

  return `<header class="top"><div><h1>Taxes ${y}</h1><div class="sub">${t.rows.length} tagged record${t.rows.length === 1 ? '' : 's'} · in ${esc(base)} at the rate of each day</div></div>
    <div class="month-switch"><button class="icon-btn" data-act="tax-year" data-step="-1" aria-label="Previous year">‹</button><b>${y}</b><button class="icon-btn" data-act="tax-year" data-step="1" aria-label="Next year" ${y >= Number(today.slice(0, 4)) ? 'disabled' : ''}>›</button></div></header>
  ${notAdvice(p)}
  <section class="card tax-sit"><h2>Your situation
    <span class="right tax-cur" role="group" aria-label="Show totals in">${SHOW_CUR.map((c) => `<button type="button" class="chip" data-act="tax-cur" data-cur="${c}" aria-pressed="${c === cur}">${c}</button>`).join('')}</span></h2>
    <label class="field"><span>Tax situation</span><select data-taxprof aria-label="Tax situation">${PROFILE_IDS.map((id) => `<option value="${id}" ${id === p.id ? 'selected' : ''}>${esc(PROFILES[id].label)}</option>`).join('')}</select></label>
    <p class="muted small">${esc(p.line)}${t.deadlines.length ? ` · ${t.deadlines.map((d) => `${esc(d.label)}${d.date ? ` by ${esc(dayLabel(d.date))} ${d.date.slice(0, 4)}` : ''}`).join(' · ')}` : ''}</p>
    ${p.warnings.map((w) => `<p class="tax-warn">${esc(w)}</p>`).join('')}
    ${cur !== base ? `<p class="muted small">Totals in ${esc(cur)} are at today's rate, for a feel only. Tax is counted in ${esc(base)}.</p>` : ''}
  </section>
  <section class="card" data-testid="tax-summary"><h2>The year <button class="btn right" data-act="tax-export" data-testid="tax-export" ${t.rows.length ? '' : 'disabled'}>Excel for your accountant</button></h2>
    <div class="tax-tiles">
      <div class="tax-tile"><span class="k">Taxable income</span><b class="income" data-tax="taxable">${shown(t.totals.taxable)}</b></div>
      <div class="tax-tile"><span class="k">Deductible costs</span><b class="expense" data-tax="deductible">${shown(t.totals.deductible)}</b></div>
      <div class="tax-tile"><span class="k">Non-taxable income</span><b data-tax="exempt">${shown(t.totals.exempt)}</b></div>
      <div class="tax-tile"><span class="k">VAT</span><b data-tax="vat">${shown(t.totals.vatIn)}</b><span class="muted small">on income · ${shown(t.totals.vatOut)} on costs</span></div>
    </div>
    ${est ? `<div class="tax-est" data-testid="tax-estimate"><span class="k">Rough estimate · ${esc(p.label)}</span><b>${shown(est.tax)}</b>
      <span class="muted small">${bpText(est.bp)} of ${exact(est.base)}${p.id === 'entrepreneur' ? ` (taxable income ${exact(est.income)} − deductible costs ${exact(est.costs)})` : p.id === 'individual' ? ` (taxable income ${exact(est.income)} − exemption ${exact(est.exemption)})` : ''}${est.tax ? ` · about ${shown(Math.round(est.tax / 12))} a month to set aside` : ''}</span></div>`
    : '<p class="muted small">No situation picked: totals only, no estimate.</p>'}
    ${t.untagged.income + t.untagged.expense ? `<p class="tax-warn" data-testid="tax-untagged">${t.untagged.income + t.untagged.expense} record${t.untagged.income + t.untagged.expense === 1 ? '' : 's'} in ${y} have no tax tag (${t.untagged.income} income, ${t.untagged.expense} costs). <button class="btn small" data-act="tax-filter" data-f="untagged">Tag them</button></p>` : ''}
    ${pending ? `<p class="tax-warn" data-testid="rc-pending">${pending} receipt${pending === 1 ? ' is' : 's are'} on this device but not in Google Drive yet. <button class="btn small" data-act="rc-connect">Connect Google Drive</button></p>` : ''}
  </section>
  ${t.rows.length ? `<div class="tax-grid">
    ${table('Taxable income by source', ['Source', 'Records', `In ${esc(base)}`], t.incomeBySource.map((g) => [esc(g.name), String(g.count), exact(g.total)]))}
    ${t.exemptBySource.length ? table('Non-taxable income', ['Source', 'Records', `In ${esc(base)}`], t.exemptBySource.map((g) => [esc(g.name), String(g.count), exact(g.total)])) : ''}
    ${table('Deductible costs by category', ['Category', 'Records', `In ${esc(base)}`], t.deductibleByCategory.map((g) => [esc(g.name), String(g.count), exact(g.total)]))}
  </div>
  <section class="card">${table('By book', ['Book', 'Taxable', 'Deductible', 'Non-taxable', 'VAT'], t.books.map((b) => [esc(bookName(state, b.book)), exact(b.taxable), exact(b.deductible), exact(b.exempt), exact(b.vatIn + b.vatOut)]), 'tax-books', true)}</section>
  <section class="card">${table('Month by month', ['Month', 'Taxable', 'Deductible', 'Non-taxable', 'VAT'], t.months.map((m) => [esc(monthLabel(m.key)), exact(m.taxable), exact(m.deductible), exact(m.exempt), exact(m.vatIn + m.vatOut)]), 'tax-months', true)}</section>` : `<div class="empty"><b>No tax-tagged records in ${y}</b>Give your income and work costs a tax tag below (once per category is enough).</div>`}
  ${tagRecords(state, y)}
  ${tagCategories(state)}
  ${numbersCard(state, y, p)}
  ${notAdvice(null)}`;
}

function table(title, head, rows, cls = '', bare = false) {
  const inner = `<h3 class="yr-h3">${title}</h3><div class="table-wrap"><table class="tax-table ${cls}"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="muted">None</td></tr>`}</tbody></table></div>`;
  return bare ? inner : `<section class="card">${inner}</section>`;
}

const tagOptions = (type, current, { auto = true, defName = '' } = {}) => `${auto ? `<option value="auto" ${current === 'auto' ? 'selected' : ''}>${defName ? `Category default (${esc(defName)})` : 'Category default (none)'}</option>` : ''}<option value="none" ${current === 'none' ? 'selected' : ''}>No tax tag</option>${tagsFor(type).map((g) => `<option value="${g.id}" ${current === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}`;

// The year's income and costs with their tag; tick some and set one tag.
function tagRecords(state, y) {
  const all = state.tx.filter((t) => String(t.date).startsWith(String(y)) && taggable(t));
  const list = all.filter((t) => (filter === 'untagged' ? !taxTagOf(state, t) && t.tax !== 'none' : filter === 'tagged' ? !!taxTagOf(state, t) : true))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const shown = list.slice(0, 200);
  for (const id of [...selected]) if (!list.some((t) => t.id === id)) selected.delete(id);
  const chip = (f, label, n) => `<button type="button" class="chip" data-act="tax-filter" data-f="${f}" aria-pressed="${filter === f}">${label} · ${n}</button>`;
  return `<section class="card tax-records" id="tax-records"><h2>Tag records</h2>
    <div class="tax-filters">${chip('untagged', 'No tag', all.filter((t) => !taxTagOf(state, t) && t.tax !== 'none').length)}${chip('tagged', 'Tagged', all.filter((t) => taxTagOf(state, t)).length)}${chip('all', 'All', all.length)}</div>
    <div class="tax-bulk"><label class="check"><input type="checkbox" data-taxall ${shown.length && shown.every((t) => selected.has(t.id)) ? 'checked' : ''}> All shown</label>
      <select data-taxbulkpick aria-label="Tax tag for the ticked records"><option value="">Tax tag…</option>${TAX_TAGS.map((g) => `<option value="${g.id}">${esc(g.label)}</option>`).join('')}<option value="none">No tax tag</option><option value="auto">Category default</option></select>
      <button type="button" class="btn primary" data-act="tax-apply" data-testid="tax-apply" ${selected.size ? '' : 'disabled'}>Set for ${selected.size} ticked</button></div>
    ${shown.length ? `<ul class="tax-list">${shown.map((t) => {
      const tag = taxTagOf(state, t);
      const src = tagSource(state, t);
      const name = t.note || category(state, t.category)?.name || '';
      return `<li data-id="${esc(t.id)}"><label class="check"><input type="checkbox" data-taxsel="${esc(t.id)}" ${selected.has(t.id) ? 'checked' : ''} aria-label="Tick ${esc(name)}"></label>
        <span class="t"><b>${esc(name)}</b><span class="muted small">${esc(dayLabel(t.date))} · ${esc(category(state, t.category)?.name || '')}${R.receiptIds(t).length ? ' · 🧾' : ''}</span></span>
        <span class="amount ${t.type === 'income' ? 'income' : ''}">${formatMoney(t.type === 'income' ? t.amount : -t.amount, t.currency || state.settings.currency)}</span>
        <select data-taxone="${esc(t.id)}" aria-label="Tax tag of ${esc(name)}">${tagOptions(t.type, src === 'own' ? t.tax : 'auto', { defName: tagLabel(category(state, t.category)?.tax) })}</select>
        <span class="tax-pill ${tag || 'none'}">${tag ? esc(TAX_TAGS.find((g) => g.id === tag).short) : '–'}</span></li>`;
    }).join('')}</ul>${list.length > shown.length ? `<p class="muted small">Showing the newest 200 of ${list.length}.</p>` : ''}` : '<p class="muted small">Nothing here.</p>'}
  </section>`;
}

function tagCategories(state) {
  const cats = state.settings.categories.filter((c) => c.type === 'income' || c.type === 'expense');
  const row = (c) => `<li><span class="t"><b>${esc(c.emoji || '')} ${esc(c.name)}</b><span class="muted small">${c.type === 'income' ? 'Income' : 'Cost'}</span></span>
    <select data-taxcat="${esc(c.id)}" aria-label="Default tax tag for ${esc(c.name)}"><option value="auto" ${!c.tax ? 'selected' : ''}>No default</option>${tagsFor(c.type).map((g) => `<option value="${g.id}" ${c.tax === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></li>`;
  return `<section class="card tax-cats"><h2>Default tag per category</h2>
    <p class="muted small">Records take their category's tag unless you set one on the record. Changing a default changes no money, only how records are sorted for taxes.</p>
    <ul class="tax-list">${cats.map(row).join('')}</ul></section>`;
}

function numbersCard(state, y, p) {
  const field = (f) => {
    const v = p.numbers[f.id];
    if (v == null && !p.overridden.includes(f.id)) return '';
    const shownV = f.unit === 'bp' ? String((v ?? 0) / 100) : centsToPlain(v ?? 0);
    return `<label class="field"><span>${esc(f.label)}${f.unit === 'bp' ? ' (%)' : ` (${esc(state.settings.currency)})`}${p.overridden.includes(f.id) ? ' <span class="pill">yours</span>' : ''}${p.unconfirmed.includes(f.id) ? ' <span class="pill pill-warn">check</span>' : ''}</span>
      <input type="text" inputmode="decimal" data-taxnum="${f.id}" value="${esc(shownV)}"></label>`;
  };
  const fields = FIELDS.map(field).join('');
  return `<section class="card tax-nums"><h2>Numbers used for ${y}${p.overridden.length ? ' <button class="btn small right" data-act="tax-reset">Back to the profile\'s numbers</button>' : ''}</h2>
    ${fields ? `<div class="row2">${fields}</div>` : '<p class="muted small">This situation uses no rates: totals only.</p>'}
    <p class="muted small">Checked ${esc(p.checked)}${p.numbersYear !== y ? ` (numbers of ${p.numbersYear})` : ''}. Sources: ${esc(p.sources.join('; ') || 'none')}. Laws change every year: check with the State Tax Service (sfs.md) or your accountant.</p></section>`;
}

// ---------- Actions ----------

function changed(text) {
  ctx.commit();
  ctx.toast(text, 'Undo', () => ctx.undo());
}

function applyTag(ids, tag) {
  const r = setTaxTag(ctx.state, ids, tag);
  if (!r.changed) { ctx.toast(r.skipped ? 'That tag does not fit those records' : 'Nothing changed'); return r; }
  selected.clear();
  changed(`Tax tag: ${tag === 'auto' ? 'category default' : tag === 'none' ? 'no tag' : tagLabel(tag)} on ${r.changed} record${r.changed === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped)` : ''}`);
  return r;
}

async function exportXlsx() {
  const y = curYear();
  await R.refreshIndex().catch(() => null);
  const sheets = accountantSheets(ctx.state, y, R.receiptIndex());
  if (ctx.download(accountantFileName(y), workbook(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') !== false) ctx.toast(`Saved ${accountantFileName(y)}. ${NOT_ADVICE}`);
}

export function onClick(act, el) {
  if (act === 'tax-year') { year = curYear() + Number(el.dataset.step); selected.clear(); ctx.render({ enter: true }); return true; }
  if (act === 'tax-cur') { showCur = el.dataset.cur; try { localStorage.setItem(CUR_KEY, showCur); } catch {} ctx.render(); return true; }
  if (act === 'tax-filter') { filter = el.dataset.f; selected.clear(); ctx.render(); setTimeout(() => document.getElementById('tax-records')?.scrollIntoView({ block: 'start' }), 0); return true; }
  if (act === 'tax-apply') {
    const tag = document.querySelector('[data-taxbulkpick]')?.value;
    if (!tag) { ctx.toast('Pick a tax tag first'); return true; }
    applyTag([...selected], tag);
    return true;
  }
  if (act === 'tax-export') { exportXlsx(); return true; }
  if (act === 'tax-reset') {
    const y = curYear();
    for (const f of FIELDS) setOverride(ctx.state, y, f.id, null);
    changed('Back to the profile\'s numbers');
    return true;
  }
  if (act === 'rc-connect') { R.connectDrive().then(() => ctx.toast('Google Drive connected: receipts upload now'), (e) => ctx.toast(e.message)); return true; }
  return false;
}

export function onChange(el) {
  const { state } = ctx;
  if (el.dataset.taxsel) { if (el.checked) selected.add(el.dataset.taxsel); else selected.delete(el.dataset.taxsel); refreshBulk(); return true; }
  if (el.hasAttribute('data-taxall')) {
    for (const box of document.querySelectorAll('[data-taxsel]')) { box.checked = el.checked; if (el.checked) selected.add(box.dataset.taxsel); else selected.delete(box.dataset.taxsel); }
    refreshBulk();
    return true;
  }
  if (el.dataset.taxone) { applyTag([el.dataset.taxone], el.value); return true; }
  if (el.dataset.taxcat) {
    const c = category(state, el.dataset.taxcat);
    if (setCategoryTag(state, el.dataset.taxcat, el.value)) changed(`${c?.name || 'Category'}: ${el.value === 'auto' ? 'no default tag' : tagLabel(el.value)}`);
    return true;
  }
  if (el.hasAttribute('data-taxprof')) {
    if (setProfile(state, el.value)) changed(`Tax situation: ${PROFILES[el.value].label}`);
    return true;
  }
  if (el.dataset.taxnum) {
    const f = FIELDS.find((x) => x.id === el.dataset.taxnum);
    const raw = String(el.value).trim().replace(',', '.');
    const v = f.unit === 'bp' ? Math.round(Number(raw) * 100) : evalAmount(raw);
    if (!raw || !Number.isSafeInteger(v) || !setOverride(state, curYear(), f.id, v)) { ctx.toast(f.unit === 'bp' ? 'Type a percent between 0 and 100' : 'Type an amount'); ctx.render(); return true; }
    changed(`${f.label}: ${f.unit === 'bp' ? bpText(v) : ctx.money(v)} (yours, for ${curYear()})`);
    return true;
  }
  return false;
}

function refreshBulk() {
  const b = document.querySelector('[data-act="tax-apply"]');
  if (b) { b.disabled = !selected.size; b.textContent = `Set for ${selected.size} ticked`; }
}

// ---------- The record sheet: tax tag and receipts ----------

// Fields the edit sheet does not show but must keep when it saves (it builds
// the record again from the form): this phase's tax tag and receipt ids,
// read from the record as it is now (it may have changed while the sheet was open).
export function keepOnEdit(state, id) {
  const now = state.tx.find((t) => t.id === id);
  if (!now) return {};
  const out = {};
  if (Object.prototype.hasOwnProperty.call(now, 'tax')) out.tax = now.tax;
  if (Array.isArray(now.receipts)) out.receipts = [...now.receipts];
  return out;
}

export function sheetRow(id) {
  const { state } = ctx;
  const t = state.tx.find((x) => x.id === id);
  if (!t || !taggable(t)) return '';
  const src = tagSource(state, t);
  const def = tagLabel(category(state, t.category)?.tax);
  const ids = R.receiptIds(t);
  const ix = R.receiptIndex();
  const label = { drive: 'In Google Drive', local: 'On this device, waiting for Google Drive', gone: 'Removed', unknown: 'On another device' };
  return `<div class="tax-sheet" data-taxsheet="${esc(t.id)}">
    <label class="field"><span>Tax tag</span><select data-sheettax aria-label="Tax tag">${tagOptions(t.type, src === 'own' ? t.tax : 'auto', { defName: def })}</select></label>
    ${t.type === 'expense' && R.inLife() ? `<div class="rc-row"><span class="rc-k">Receipts</span>
      ${ids.map((rid) => `<span class="rc-chip ${R.receiptStatus(ix, rid)}" data-rid="${esc(rid)}"><button type="button" class="linkish" data-rc="open" data-rid="${esc(rid)}" title="${esc(label[R.receiptStatus(ix, rid)])}">🧾 ${esc(ix[rid]?.name || 'Receipt')}</button><span class="muted small">${esc(label[R.receiptStatus(ix, rid)])}</span><button type="button" class="icon-btn" data-rc="remove" data-rid="${esc(rid)}" aria-label="Take this receipt off the record">✕</button></span>`).join('')}
      <button type="button" class="btn small" data-rc="add" data-testid="rc-add">Attach receipt</button><input type="file" data-rcfile accept="image/*,application/pdf" hidden>
      <div class="rc-view" hidden></div></div>` : ''}
  </div>`;
}

// Bound once on the record sheet (its contents are redrawn, the sheet stays).
export function bindSheet(sheet) {
  const box = () => sheet.querySelector('[data-taxsheet]');
  const rec = () => ctx.state.tx.find((t) => t.id === box()?.dataset.taxsheet);
  const redraw = () => { const b = box(); if (b) b.outerHTML = sheetRow(b.dataset.taxsheet); };
  sheet.addEventListener('change', async (e) => {
    const t = rec();
    if (!t) return;
    if (e.target.matches('[data-sheettax]')) {
      const r = setTaxTag(ctx.state, [t.id], e.target.value);
      if (r.changed) changed(`Tax tag: ${e.target.value === 'auto' ? 'category default' : e.target.value === 'none' ? 'no tag' : tagLabel(e.target.value)}`);
      return;
    }
    if (e.target.matches('[data-rcfile]')) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        ctx.toast('Keeping the receipt on this device…');
        const rid = await R.sendReceipt(t, file);
        const live = ctx.state.tx.find((x) => x.id === t.id);
        if (live && R.addReceiptId(live, rid)) { ctx.commit(); ctx.toast('Receipt kept on this device; it goes to your Google Drive next'); }
        await R.refreshIndex([rid]);
        redraw();
      } catch (err) { ctx.toast(err.message || 'Could not keep that receipt'); }
    }
  });
  sheet.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rc]');
    if (!b || !box()) return;
    const t = rec();
    if (!t) return;
    if (b.dataset.rc === 'add') { box().querySelector('[data-rcfile]')?.click(); return; }
    if (b.dataset.rc === 'remove') {
      // Two taps: the first asks (the file itself is never deleted here).
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Take off? (file kept)'; b.classList.add('rc-armed'); return; }
      if (R.removeReceiptId(t, b.dataset.rid)) { ctx.commit(); ctx.toast('Receipt taken off this record (the file is kept)', 'Undo', () => ctx.undo()); redraw(); }
      return;
    }
    if (b.dataset.rc === 'open') {
      const view = box().querySelector('.rc-view');
      try {
        const r = await R.openReceipt(b.dataset.rid);
        const url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime || 'application/octet-stream' }));
        view.hidden = false;
        view.innerHTML = `${/^image\//.test(r.mime) ? `<img src="${url}" alt="Receipt">` : ''}<a class="btn small" href="${url}" download="${esc(r.name || 'receipt')}">Save a copy</a>${r.webLink ? ` <a class="btn small" href="${esc(r.webLink)}" target="_blank" rel="noopener">Open in Google Drive</a>` : ''}`;
      } catch (err) { ctx.toast(err.message || 'Could not open the receipt'); }
    }
  });
  if (R.inLife()) R.refreshIndex().then(redraw).catch(() => {});
}

// The Log table's bulk bar: one more choice, "Tax tag…".
export const bulkSelectHTML = () => `<select data-bulk="tax" aria-label="Set tax tag"><option value="">Tax tag…</option>${TAX_TAGS.map((g) => `<option value="${g.id}">${esc(g.label)}</option>`).join('')}<option value="none">No tax tag</option><option value="auto">Category default</option></select>`;

// For the bulk bar: set the tag on one record; false when it does not fit.
export function bulkTag(t, v) {
  if (!taggable(t) || (TAX_TAGS.some((g) => g.id === v) && !tagFits(v, t.type))) return false;
  return setTaxTag(ctx.state, [t.id], v).changed > 0 || true;
}
