// Money Home: favourites (one click adds today's record, with Undo) and the
// emergency fund meter, plus the Settings card for the meter. The numbers
// come from favorites.js and emergency.js (pure, tested); amounts are shown
// with formatMoney so "hidden" covers them.

import { ctx, esc } from '../ctx.js';
import { formatMoney } from '../money.js';
import { todayISO } from '../dates.js';
import { rankFavorites, togglePin, favTx, MAX_FAVS } from '../favorites.js';
import { emergencyFund, advice, monthsText, fundAccounts, essentialIds, MARKS, SCALE_MAX } from '../emergency.js';
import { rateToBase } from '../fx.js';
import * as M from '../model.js';

const favs = () => rankFavorites(ctx.state, todayISO(), { n: MAX_FAVS });
const label = (f) => f.note || M.category(ctx.state, f.category)?.name || 'Record';

export function favsCard() {
  const list = favs();
  if (!list.length) return '';
  return `<section class="card favs" data-testid="favs" aria-label="Favourites">
    <h2>Favourites <span class="muted small">One tap adds it for today. Hold or right-click to edit first.</span></h2>
    <div class="favs-row">${list.map((f, i) => `<span class="fav${f.pinned ? ' pinned' : ''}"><button type="button" class="fav-add" data-act="fav-add" data-i="${i}" title="Add ${esc(label(f))} for today. Hold or right-click to edit first.">${f.pinned ? '<span class="gold">★</span> ' : ''}${esc(label(f))} <b class="${f.type === 'income' ? 'income' : ''}">${formatMoney(f.amount, f.currency, { compact: true })}</b></button><button type="button" class="fav-pin" data-act="fav-pin" data-i="${i}" aria-pressed="${f.pinned}" aria-label="${f.pinned ? 'Unpin' : 'Pin'} ${esc(label(f))}" title="${f.pinned ? 'Unpin' : 'Pin: keep this one'}">${f.pinned ? 'Unpin' : 'Pin'}</button></span>`).join('')}</div>
  </section>`;
}

export function emergencyCard() {
  const state = ctx.state;
  if (!state.tx.length) return '';
  const r = emergencyFund(state, todayISO());
  if (!r.ok) {
    return `<section class="card ef" data-testid="emergency"><h2>Emergency fund</h2><p class="muted small" style="margin:0">Needs about a month of spending records to work out your months of cover.</p></section>`;
  }
  const pct = (m) => Math.min(100, Math.max(0, (m / SCALE_MAX) * 100));
  const lvl = r.months >= 6 ? 'ok' : r.months >= 3 ? 'mid' : 'low';
  const basis = r.basis === 'essential' ? 'essential spending' : 'all spending';
  return `<section class="card ef ef-${lvl}" data-testid="emergency">
    <h2>Emergency fund: <b data-testid="emergency-months">${monthsText(r.months)} months</b></h2>
    <div class="ef-bar" role="img" aria-label="${monthsText(r.months)} months of cover; marks at 3 and 6 months"><i style="width:${pct(r.months)}%"></i>${MARKS.map((m) => `<span class="ef-mark" style="left:${pct(m)}%"><em>${m}</em></span>`).join('')}</div>
    <p class="ef-advice">${esc(advice(r.months))}</p>
    <p class="muted small" style="margin:6px 0 0">${esc(formatMoney(r.savings, ''))} ÷ ${esc(formatMoney(r.monthly, ''))} a month of ${basis} (last ${r.counted} month${r.counted === 1 ? '' : 's'}). <button type="button" class="card-link" data-go="settings">Change in Settings</button></p>
  </section>`;
}

export function settingsCard() {
  const state = ctx.state;
  const chosen = new Set(fundAccounts(state).list.map((a) => a.id));
  const own = fundAccounts(state).own;
  const ess = essentialIds(state);
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const cats = state.settings.categories.filter((c) => c.type === 'expense' && !c.archived);
  return `<section class="card" data-testid="emergency-settings"><h2>Emergency fund</h2>
    <p class="muted small" style="margin-top:0">Months of cover = savings ÷ your average monthly spending on essentials (last 3 months). ${own ? '' : 'Right now it uses your savings accounts.'}</p>
    <h3 class="small">Which accounts are the fund?</h3>
    <div class="ef-picks">${accs.map((a) => `<label class="ef-pick"><input type="checkbox" data-act="ef-acc" data-id="${esc(a.id)}" ${chosen.has(a.id) ? 'checked' : ''}><span>${esc(a.name)}</span></label>`).join('')}</div>
    <h3 class="small">Which spending is essential?</h3>
    <div class="ef-picks">${cats.map((c) => `<label class="ef-pick"><input type="checkbox" data-act="ef-cat" data-id="${esc(c.id)}" ${ess?.has(c.id) ? 'checked' : ''}><span>${esc(`${c.emoji || ''} ${c.name}`.trim())}</span></label>`).join('')}</div>
    <p class="muted small" style="margin-bottom:0">${ess ? 'Only the ticked categories count.' : 'None ticked: all your spending counts.'}</p>
  </section>`;
}

/** Add favourite `i` for today and offer Undo. */
function addFav(f) {
  const state = ctx.state;
  const cur = f.currency || state.settings.currency;
  const rate = cur === state.settings.currency ? 1 : rateToBase(state, cur);
  if (!(rate > 0)) { ctx.toast(`No ${cur} rate yet. Update rates first.`); return; }
  const now = Date.now();
  const tx = favTx(f, todayISO(), { id: M.uid(), now, rate });
  state.tx.push(tx);
  ctx.ui.flashId = tx.id;
  ctx.commit();
  ctx.toast(`Added ${label(f)} ${formatMoney(f.amount, cur)}`, 'Undo', () => ctx.undo?.());
}

function editFav(f) {
  ctx.openTxSheet(null, { type: f.type, note: f.note, category: f.category, account: f.account, ...(f.sub ? { sub: f.sub } : {}), amountText: String(f.amount / 100) });
}

// Returns true when the action belongs to these cards.
export function onClick(act, el) {
  const state = ctx.state;
  if (act === 'fav-add' || act === 'fav-pin') {
    if (state._sealed) return true;
    const f = favs()[Number(el.dataset.i)];
    if (!f) return true;
    if (el.dataset.longDone) { delete el.dataset.longDone; return true; }
    if (act === 'fav-add') addFav(f);
    else {
      const on = togglePin(state, f);
      ctx.persistSync();
      ctx.render();
      ctx.toast(on ? 'Pinned. It stays in your favourites.' : 'Unpinned.');
    }
    return true;
  }
  if (act === 'ef-acc' || act === 'ef-cat') {
    const key = act === 'ef-acc' ? 'accounts' : 'essential';
    const cur = { ...(state.settings.emergency || {}) };
    const base = act === 'ef-acc' && !Array.isArray(cur.accounts) ? fundAccounts(state).list.map((a) => a.id) : (cur[key] || []);
    const set = new Set(base);
    if (el.checked) set.add(el.dataset.id); else set.delete(el.dataset.id);
    // Unticking the last account goes back to "your savings accounts".
    state.settings.emergency = { ...cur, [key]: [...set] };
    state.settings.updatedAt = Date.now();
    ctx.persistSync();
    return true;
  }
  return false;
}

// Right-click, or hold (touch), on a favourite: edit it before adding.
let timer = 0;
export function install() {
  const target = (e) => e.target.closest?.('[data-act="fav-add"]');
  document.addEventListener('contextmenu', (e) => {
    const el = target(e);
    if (!el) return;
    e.preventDefault();
    const f = favs()[Number(el.dataset.i)];
    if (f) editFav(f);
  });
  document.addEventListener('pointerdown', (e) => {
    const el = target(e);
    if (!el || e.pointerType === 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const f = favs()[Number(el.dataset.i)];
      if (!f) return;
      el.dataset.longDone = '1';
      editFav(f);
    }, 550);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointermove']) document.addEventListener(ev, () => clearTimeout(timer));
}
