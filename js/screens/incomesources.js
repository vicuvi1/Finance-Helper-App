// Income sources, the screens (rules and numbers are in js/incomesources.js):
//   Settings → Income sources: add, rename, recolour, pick an icon, reorder, archive,
//     and "Create from your records" (you confirm each one; nothing changes silently).
//   The "Source" chips of the add/edit form and the coloured tag on Earned rows.
//   Reports → "Income by source": this month and the last 12 months, and the records behind a source.
// Archived sources are never deleted: they stay on their records and in reports.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as IS from '../incomesources.js';
import { evalAmount, centsToPlain } from '../money.js';
import { todayISO, monthLabel } from '../dates.js';
import { wholePercents } from '../catshare.js';

export const colorOf = IS.colorVar;

// ---------- The picker in the add/edit form ----------

/** Chips for the form of an Earned record. `selected`: a source id or null; `adding`: the inline "new source" box is open. */
export function pickerHTML(state, { selected = null, adding = false } = {}) {
  const act = IS.activeSources(state);
  const cur = IS.sourceById(state, selected);
  // A record keeps an archived source: shown, so it is not lost by saving.
  const list = cur?.archived ? [...act, cur] : act;
  const chips = list.map((s) => `<button type="button" class="src-chip" data-src="${esc(s.id)}" data-testid="src-chip" aria-pressed="${selected === s.id}" style="--c:${colorOf(s)}"><i aria-hidden="true"></i><span>${s.emoji ? `${esc(s.emoji)} ` : ''}${esc(s.name)}${s.archived ? ' (archived)' : ''}</span></button>`).join('');
  const add = adding
    ? `<span class="cat-new"><input id="new-src" type="text" maxlength="${IS.MAX_NAME}" placeholder="New source, e.g. Job 2" aria-label="New source name" data-testid="new-src"><button type="button" class="btn primary" data-act="src-form-create" data-testid="src-form-create">Add</button></span>`
    : '<button type="button" class="src-chip src-add" data-act="src-form-new" data-testid="src-form-new">+ New source</button>';
  return `<div class="src-pick" role="group" aria-label="Income source" data-testid="src-picker"><span class="src-pick-l">Source</span>${chips}${add}</div>`;
}

// ---------- Settings → Income sources ----------

const money = (c) => ctx.money(c);

function metaOf(state, s) {
  const bits = [];
  if (s.expected) bits.push(`about ${ctx.money(s.expected).replace(state.settings.currency, s.currency || state.settings.currency)} a month`);
  if (s.payday) bits.push(`pay day ${s.payday}`);
  if (s.currency && !s.expected) bits.push(s.currency);
  const acc = s.account && M.account(state, s.account);
  if (acc) bits.push(acc.name);
  return bits.join(' · ');
}

function rowHTML(state, s, i, n) {
  const used = state.tx.filter((t) => t.incomeSource === s.id).length;
  return `<div class="src-row${s.archived ? ' is-archived' : ''}" data-testid="src-row" data-id="${esc(s.id)}" style="--c:${colorOf(s)}">
    <span class="src-dot" aria-hidden="true">${esc(s.emoji || '')}</span>
    <span class="src-info"><b>${esc(s.name)}</b><small class="muted">${esc([metaOf(state, s), used ? `${used} record${used === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'No records yet')}</small></span>
    <span class="src-actions">
      ${s.archived ? '' : `<button type="button" class="icon-btn" data-act="src-up" data-id="${esc(s.id)}" aria-label="Move ${esc(s.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-btn" data-act="src-down" data-id="${esc(s.id)}" aria-label="Move ${esc(s.name)} down" ${i === n - 1 ? 'disabled' : ''}>↓</button>`}
      <button type="button" class="btn sm" data-act="src-edit" data-id="${esc(s.id)}" data-testid="src-edit">Edit</button>
      <button type="button" class="btn sm" data-act="${s.archived ? 'src-restore' : 'src-archive'}" data-id="${esc(s.id)}" data-testid="${s.archived ? 'src-restore' : 'src-archive'}">${s.archived ? 'Bring back' : 'Archive'}</button>
    </span></div>`;
}

export function settingsCard() {
  const { state } = ctx;
  const act = IS.activeSources(state);
  const old = IS.sourcesOf(state).filter((s) => s.archived);
  const sug = IS.suggestSources(state).length;
  return `<section class="card" id="src-card" data-testid="src-settings"><h2>Income sources</h2>
    <p class="muted small" style="margin-top:0">Tag the money you earn with where it came from: Job 1, Job 2, a client. Pick one when you add an Earned record, or type <b>@job2</b> in quick add. Reports shows each source's total. An archived source is hidden from the pickers but stays on its old records and in reports.</p>
    ${act.length ? `<div class="src-list" data-testid="src-list">${act.map((s, i) => rowHTML(state, s, i, act.length)).join('')}</div>` : '<p class="muted small" data-testid="src-empty">No sources yet.</p>'}
    <div class="btns" style="justify-content:flex-start">
      <button type="button" class="btn primary" data-act="src-new" data-testid="src-new">+ New source</button>
      ${sug ? `<button type="button" class="btn" data-act="src-suggest" data-testid="src-suggest">Create from your records (${sug})</button>` : ''}
    </div>
    ${old.length ? `<details class="src-old"><summary>Archived (${old.length})</summary><div class="src-list">${old.map((s) => rowHTML(state, s, 0, 1)).join('')}</div></details>` : ''}
  </section>`;
}

const swatches = (cur) => Array.from({ length: IS.COLOR_SLOTS }, (_, i) => i + 1).map((c) => `<button type="button" class="src-sw" data-sw="${c}" aria-pressed="${cur === c}" aria-label="Colour ${c}" style="--c:var(--c${c})"></button>`).join('');
const icons = (cur) => IS.ICONS.map((e) => `<button type="button" class="src-ic" data-ic="${esc(e)}" aria-pressed="${cur === e}" aria-label="Icon ${esc(e)}">${esc(e)}</button>`).join('');

/** The sheet to add (id null) or edit a source. */
export function openEdit(id = null) {
  const { state } = ctx;
  const s = id ? IS.sourceById(state, id) : null;
  if (id && !s) return;
  const base = state.settings.currency;
  const pick = { color: s?.color || (IS.activeSources(state).length % IS.COLOR_SLOTS) + 1, emoji: s?.emoji || '💼' };
  const curs = [...new Set([s?.currency, base, 'USD', 'EUR', ...state.settings.accounts.map((a) => a.currency)].filter(Boolean))];
  const accs = M.activeAccounts(state);
  ctx.openSheet(`<form id="src-form" novalidate data-testid="src-form"><h3>${s ? 'Edit source' : 'New income source'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <label class="field"><span>Name</span><input id="src-name" type="text" maxlength="${IS.MAX_NAME}" autocomplete="off" value="${esc(s?.name || '')}" placeholder="e.g. Job 1" data-testid="src-name"></label>
    <div class="field"><span>Icon</span><div class="src-ics" id="src-ics">${icons(pick.emoji)}</div></div>
    <div class="field"><span>Colour</span><div class="src-sws" id="src-sws">${swatches(pick.color)}</div></div>
    <p class="muted small" style="margin:6px 0">Optional. With an amount and a pay day, Money Home tells you when this income is late or lower than usual.</p>
    <div class="row2">
      <label class="field"><span>Usual currency</span><select id="src-cur"><option value="">${esc(base)} (main)</option>${curs.filter((c) => c !== base).map((c) => `<option ${c === s?.currency ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field"><span>Usual account</span><select id="src-acc"><option value="">Any account</option>${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === s?.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    </div>
    <div class="row2">
      <label class="field"><span>Expected a month</span><input id="src-exp" type="text" inputmode="decimal" value="${s?.expected ? centsToPlain(s.expected) : ''}" placeholder="e.g. 15000" data-testid="src-exp"></label>
      <label class="field"><span>Pay day of the month</span><input id="src-day" type="number" min="1" max="31" value="${s?.payday || ''}" placeholder="10" data-testid="src-day"></label>
    </div>
    <div class="calc-hint" id="src-msg" role="status"></div>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" data-testid="src-save">${s ? 'Save' : 'Add source'}</button></div></form>`, (sheet) => {
    const msg = (t) => { const m = sheet.querySelector('#src-msg'); m.textContent = t; m.style.color = 'var(--expense)'; };
    sheet.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-sw]');
      if (sw) { pick.color = Number(sw.dataset.sw); for (const b of sheet.querySelectorAll('[data-sw]')) b.setAttribute('aria-pressed', String(b === sw)); return; }
      const ic = e.target.closest('[data-ic]');
      if (ic) { pick.emoji = ic.dataset.ic; for (const b of sheet.querySelectorAll('[data-ic]')) b.setAttribute('aria-pressed', String(b === ic)); }
    });
    sheet.querySelector('#src-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (x) => sheet.querySelector(x).value.trim();
      const expText = v('#src-exp');
      const exp = expText ? evalAmount(expText) : null;
      if (expText && !(exp > 0)) return msg('Type the amount you expect, e.g. 15000');
      const dayText = v('#src-day');
      const day = dayText ? Math.round(Number(dayText)) : null;
      if (dayText && !(day >= 1 && day <= 31)) return msg('A pay day between 1 and 31');
      const fields = { name: v('#src-name'), color: pick.color, emoji: pick.emoji, currency: v('#src-cur'), account: v('#src-acc'), expected: exp, payday: day };
      const r = s ? IS.updateSource(state, s.id, fields) : IS.addSource(state, fields);
      if (!r.ok) return msg(r.error === 'exists' ? `You already have a source called "${r.source.name}"${r.source.archived ? ' (archived: bring it back instead)' : ''}.` : 'Give the source a name.');
      ctx.closeSheet();
      ctx.commit();
      ctx.toast(s ? 'Saved' : `Added the source ${r.source.name}`, 'Undo', () => ctx.undo());
    });
    setTimeout(() => sheet.querySelector('#src-name')?.focus(), 30);
  });
}

/** "Create from your records": confirm each suggestion; nothing changes before you press the button. */
export function openSuggestions() {
  const { state } = ctx;
  const list = IS.suggestSources(state);
  const kindWord = { category: 'category', note: 'note' };
  ctx.openSheet(`<h3>Create sources from your records <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    ${list.length ? `<p class="muted small" style="margin-top:0">Tick the ones that are really a job or a client. You can rename them. Nothing changes until you press Create.</p>
    <div class="src-sug" data-testid="src-suggestions">${list.map((g) => `<div class="src-sug-row" data-key="${esc(g.key)}" data-testid="src-suggestion">
      <input type="checkbox" class="sg-on" aria-label="Create ${esc(g.name)}" data-testid="sg-on">
      <input type="text" class="sg-name" maxlength="${IS.MAX_NAME}" value="${esc(g.name)}" aria-label="Name">
      <span class="muted small">${g.count} record${g.count === 1 ? '' : 's'} · ${esc(money(g.total))} · from a ${kindWord[g.kind]}</span></div>`).join('')}</div>
    <label class="field check"><input type="checkbox" id="sg-tag" checked><span>Also tag their past records with the new source (one Undo takes it back)</span></label>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" id="sg-go" data-testid="sg-create">Create the ticked ones</button></div>`
    : '<p class="muted">Nothing to suggest yet. Earned records in a category like Work, or with a note you repeat (a client, a job), would show up here.</p><div class="btns"><button type="button" class="btn" data-close>Close</button></div>'}`, (sheet) => {
    sheet.querySelector('#sg-go')?.addEventListener('click', () => {
      const chosen = [...sheet.querySelectorAll('.src-sug-row')].filter((r) => r.querySelector('.sg-on').checked)
        .map((r) => ({ key: r.dataset.key, name: r.querySelector('.sg-name').value.trim() }));
      if (!chosen.length) { ctx.toast('Tick at least one'); return; }
      const out = IS.applySuggestions(state, chosen, { tag: sheet.querySelector('#sg-tag').checked });
      ctx.closeSheet();
      if (!out.created.length) { ctx.toast('Nothing was created (those names are taken)'); return; }
      ctx.commit();
      ctx.toast(`Created ${out.created.length} source${out.created.length === 1 ? '' : 's'}${out.tagged ? ` and tagged ${out.tagged} record${out.tagged === 1 ? '' : 's'}` : ''}`, 'Undo', () => ctx.undo());
    });
  });
}

// ---------- Reports → Income by source ----------

/** The Reports card. Empty until you have a source. Always "this month and the last 12 months". */
export function reportCard(today = todayISO()) {
  const { state } = ctx;
  if (!IS.hasSources(state)) return '';
  const r = IS.sourceReport(state, today);
  const known = new Map(IS.sourcesOf(state).map((s) => [s.id, s]));
  const colorFor = (id) => (id === IS.NONE ? 'var(--faint)' : colorOf(known.get(id)));
  const max = Math.max(1, ...r.monthTotals);
  const thisLine = r.thisMonth.rows.length
    ? r.thisMonth.rows.map((x) => `<span class="src-mini" style="--c:${colorFor(x.id)}"><i aria-hidden="true"></i>${esc(x.id === IS.NONE ? 'No source' : known.get(x.id)?.name || '')} <b class="font-num">${esc(money(x.amount))}</b></span>`).join('')
    : '<span class="muted">Nothing earned yet this month.</span>';
  const bars = r.keys.map((k, i) => {
    const total = r.monthTotals[i];
    const segs = r.rows.filter((x) => x.byMonth[i] > 0).map((x) => `<i class="sb-seg" style="height:${((x.byMonth[i] / max) * 100).toFixed(2)}%;background:${colorFor(x.id)}" title="${esc(x.name)}: ${esc(money(x.byMonth[i]))}"></i>`).join('');
    return `<div class="sb-col" style="--i:${i}" title="${esc(monthLabel(k))}: ${esc(money(total))}"><span class="sb-stack">${segs}</span><span class="sb-l">${esc(r.labels[i])}</span></div>`;
  }).join('');
  const pcts = wholePercents(r.rows.map((x) => x.total)); // whole percents that add up to 100
  const rows = r.rows.map((x, i) => `<tr class="click" data-act="src-rep-open" data-id="${esc(x.id)}" data-testid="src-rep-row">
    <td><span class="src-name-cell" style="--c:${colorFor(x.id)}"><i aria-hidden="true"></i><span>${x.emoji ? `${esc(x.emoji)} ` : ''}${esc(x.name)}${x.archived ? ' <small class="muted">(archived)</small>' : ''}</span></span></td>
    <td class="num income font-num" data-testid="src-total"><b>${esc(money(x.total))}</b></td>
    <td class="num font-num muted">${pcts[i]}%</td>
    <td class="num font-num muted">${esc(money(x.avg))}</td>
    <td class="num font-num muted">${x.count}</td></tr>`).join('');
  return `<section class="card src-report" id="src-report" data-testid="src-report">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px">
      <h2 style="margin:0">Income by source</h2><b class="income" data-testid="src-report-total">${esc(money(r.total))} <small class="muted">in 12 months</small></b></div>
    <div class="src-this" data-testid="src-this"><span class="muted small">This month</span> ${thisLine}</div>
    ${r.total ? `<div class="src-bars" data-testid="src-bars" role="img" aria-label="Income by source for each of the last 12 months">${bars}</div>
    <div class="table-wrap"><table class="rep-table"><thead><tr><th>Source</th><th class="num">12 months</th><th class="num">Share</th><th class="num">Per month</th><th class="num">Records</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small" style="margin:6px 0 0">Per month = the total over the months since its first record. Other currencies are counted in ${esc(state.settings.currency)}; records marked "not income" are left out. Tap a source to see its records.</p>`
    : '<p class="muted" style="margin:0">Nothing earned in the last 12 months.</p>'}
  </section>`;
}

/** The records of one source over the last 12 months. */
export function openSourceSheet(id, today = todayISO()) {
  const { state } = ctx;
  const r = IS.sourceReport(state, today);
  const row = r.rows.find((x) => x.id === id);
  const from = `${r.keys[0]}-01`;
  const items = IS.sourceRecords(state, id, from, `${r.keys.at(-1)}-31`);
  const name = id === IS.NONE ? 'No source' : IS.sourceName(state, id) || 'Source';
  const max = Math.max(1, ...(row?.byMonth || [0]));
  ctx.openSheet(`<h3>${esc(name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><span class="k">12 months</span><b data-testid="src-sheet-total">${esc(money(row?.total || 0))}</b></div>
      <div class="stat"><span class="k">Share</span><b>${Math.round((row?.share || 0) * 100)}%</b></div>
      <div class="stat"><span class="k">Per month</span><b>${esc(money(row?.avg || 0))}</b></div>
    </div>
    <div class="mini-months mm12">${(row?.byMonth || []).map((v, i) => `<div class="mm"><span class="mm-bar"><i style="height:${((v / max) * 100).toFixed(1)}%"></i></span><span class="mm-l">${esc(r.labels[i])}</span></div>`).join('')}</div>
    ${items.length ? `<div class="list">${items.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records.</p>'}`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const rowEl = e.target.closest('[data-act="edit"]');
      if (rowEl) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === rowEl.dataset.id)); }
    });
  });
}

// ---------- Clicks ----------

function change(fn, msg) {
  fn();
  ctx.commit();
  if (msg) ctx.toast(msg, 'Undo', () => ctx.undo());
}

export function onClick(act, el) {
  const { state } = ctx;
  const id = el?.dataset?.id;
  switch (act) {
    case 'src-new': openEdit(null); return true;
    case 'src-edit': openEdit(id); return true;
    case 'src-suggest': openSuggestions(); return true;
    case 'src-up': case 'src-down': change(() => IS.moveSource(state, id, act === 'src-up' ? -1 : 1)); return true;
    case 'src-archive': change(() => IS.archiveSource(state, id, true), 'Archived. Old records keep it.'); return true;
    case 'src-restore': change(() => IS.archiveSource(state, id, false), 'Brought back'); return true;
    case 'src-rep-open': openSourceSheet(id); return true;
    default: return false;
  }
}
