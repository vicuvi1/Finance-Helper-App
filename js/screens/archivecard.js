// Settings -> Data & backups -> "Archive old years" (js/archive.js).
// A backup is saved first (when Finance runs inside Life System), the records
// of finished years move into the archive, balances stay exactly the same, and
// Unarchive puts every record back. Nothing here is a record edit.

import { ctx, esc } from '../ctx.js';
import { todayISO } from '../dates.js';
import { archivable, archiveBefore, archiveChoices, archiveInfo, unarchiveAll } from '../archive.js';
import { backupBefore } from '../dupes.js';

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const noun = (n) => `${n} record${n === 1 ? '' : 's'}`;

// The year to offer first: keep last year's records, archive the ones before.
export const defaultYear = (choices, today) => {
  const prefer = Number(today.slice(0, 4)) - 1;
  return choices.includes(prefer) ? prefer : choices.at(-1) ?? null;
};

export function settingsCard() {
  const st = ctx.state;
  if (!st || st._sealed) return '';
  const today = todayISO();
  const info = archiveInfo(st);
  const choices = archiveChoices(st, today);
  const pick = defaultYear(choices, today);
  const years = info.years.map((y) => y.year);
  const done = info.archived
    ? `<p class="arch-note" data-testid="archive-state"><b>${noun(info.count)}</b> from ${esc(years.length > 1 ? `${years[0]}–${years.at(-1)}` : String(years[0] ?? ''))} are archived (before ${esc(info.cutoff.slice(0, 4))}), about ${kb(info.bytes)}. Balances, the year summary, reports and the long view still count them.</p>`
    : '';
  const control = choices.length
    ? `<div class="arch-years"><label for="arch-year">Archive years before</label>
        <select id="arch-year" data-testid="archive-year" aria-label="Archive years before">${choices.map((y) => `<option value="${y}"${y === pick ? ' selected' : ''}>${y}</option>`).join('')}</select>
        <button type="button" class="btn" data-arch="ask" data-testid="archive-go">Archive</button></div>
       <p class="muted small arch-note" id="arch-pre" data-testid="archive-preview">${previewText(st, pick)}</p>`
    : `<p class="muted small arch-note" data-testid="archive-none">No finished years with records to archive yet.</p>`;
  return `<section class="card" data-testid="archive-card"><h2>Archive old years</h2>
    <p class="muted small" style="margin-top:0">Moves the records of finished years out of your everyday data, so the app stays quick after years of use. Account balances, the Year in review, Reports, the Long view and net worth stay exactly the same. A backup is saved first, it syncs between your devices, and Unarchive puts every record back.</p>
    ${done}${control}
    ${info.archived ? '<div class="btns"><button type="button" class="btn" data-arch="undo" data-testid="archive-undo">Unarchive</button></div>' : ''}
    <p class="muted small arch-note">To find archived records, tick “Include archived years” next to the Log search. Archived records can be read but not changed; Unarchive first to edit them.</p></section>`;
}

function previewText(st, year) {
  if (!year) return '';
  const n = archivable(st, year).length;
  return n ? `${noun(n)} before ${year} would move.` : `Nothing before ${year} to move.`;
}

export function askSheet(year) {
  const st = ctx.state;
  const n = archivable(st, year).length;
  if (!n) { ctx.toast(`Nothing before ${year} to archive`); return; }
  ctx.openSheet(`<h3>Archive years before ${esc(year)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p>${noun(n)} from before ${esc(year)} move into the archive. Balances and totals do not change. A backup is saved first. You can Unarchive any time.</p>
    <div class="btns"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-arch="do" data-year="${esc(year)}" data-testid="archive-confirm">Archive ${noun(n)}</button></div>`);
}

async function doArchive(year, btn) {
  const st = ctx.state;
  const n = archivable(st, year).length;
  if (!n) return;
  if (btn) btn.disabled = true;
  const bk = await backupBefore(`archiving years before ${year}`);
  if (!bk.ok) { if (btn) btn.disabled = false; ctx.toast(`Nothing was archived: ${bk.error}`); return; }
  const moved = ctx.archiveApply((s) => archiveBefore(s, Number(year), Date.now()));
  ctx.closeSheet();
  ctx.toast(`Archived ${noun(moved)} from before ${year}`, 'Unarchive', () => doUnarchive(true));
}

function doUnarchive(quiet) {
  const moved = ctx.archiveApply((s) => unarchiveAll(s, Date.now()));
  ctx.toast(moved ? `Unarchived ${noun(moved)}` : 'Nothing was archived');
  return quiet ? moved : moved;
}

let bound = false;
export function init() {
  if (bound) return;
  bound = true;
  document.addEventListener('change', (e) => {
    const sel = e.target.closest?.('#arch-year');
    if (!sel) return;
    const pre = document.getElementById('arch-pre');
    if (pre) pre.textContent = previewText(ctx.state, Number(sel.value));
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-arch]');
    if (!el) return;
    const a = el.dataset.arch;
    if (a === 'ask') { const y = Number(document.getElementById('arch-year')?.value); if (y) askSheet(y); }
    else if (a === 'do') doArchive(Number(el.dataset.year), el);
    else if (a === 'undo') doUnarchive();
  });
}
