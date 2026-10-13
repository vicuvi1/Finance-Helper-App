// People & Loans: who gave you money, who you gave to, debts and loan
// settlements (who owes whom), grouped (Family, Friends, Work…). Loans are
// kept in the currency they were made in, so "owes you 100 USD" stays 100 USD
// whatever the rate. Each person can be edited fully (name, group, currency, note)
// or deleted; their records stay, with the name written on them.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import { todayISO, dayLabel } from '../dates.js';
import { formatMoney, evalAmount, centsToPlain } from '../money.js';
import { convert, FIAT } from '../fx.js';

const initialOf = (name) => esc((String(name).match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase());

export const colorOf = (p) => {
  if (p && p.color) {
    return p.color.startsWith('var(') || p.color.startsWith('#') || p.color.startsWith('rgb') ? p.color : `var(--${p.color})`;
  }
  let h = 0;
  for (const ch of (p?.id || 'p')) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return `var(--c${(h % 8) + 1})`;
};

export function personAvatar(p, { size = '', cls = '' } = {}) {
  if (!p) return '';
  const pc = colorOf(p);
  const classes = ['pp-av', size, cls].filter(Boolean).join(' ');
  if (p.image) {
    return `<span class="${classes} has-img" style="--pc:${pc}" aria-hidden="true"><img src="${esc(p.image)}" alt="${esc(p.name)}" class="pp-av-img" onerror="this.parentElement.classList.remove('has-img'); this.remove();"></span>`;
  }
  if (p.emoji) {
    return `<span class="${classes} emoji" style="--pc:${pc}" aria-hidden="true">${esc(p.emoji)}</span>`;
  }
  return `<span class="${classes}" style="--pc:${pc}" aria-hidden="true">${initialOf(p.name)}</span>`;
}

export const EMOJI_PALETTE = [
  '👩', '👨', '👵', '👴', '👦', '👧', '👶', '❤️', '🏡',
  '💼', '🧑‍💻', '👩‍💼', '👔', '🏢', '🤝', '📑', '💵', '📊',
  '😎', '🥳', '🍻', '☕', '⚽', '🏋️', '🎮', '🚗', '🎸',
  '👑', '⭐', '🦁', '🐱', '🐶', '🥋', '🩺', '🎓', '🎨',
];

export const COLOR_PRESETS = [
  { id: 'c1', name: 'Emerald', value: 'var(--c1)' },
  { id: 'c2', name: 'Sky', value: 'var(--c2)' },
  { id: 'c3', name: 'Purple', value: 'var(--c3)' },
  { id: 'c4', name: 'Pink', value: 'var(--c4)' },
  { id: 'c5', name: 'Orange', value: 'var(--c5)' },
  { id: 'c6', name: 'Teal', value: 'var(--c6)' },
  { id: 'c7', name: 'Gold', value: 'var(--c7)' },
  { id: 'c8', name: 'Coral', value: 'var(--c8)' },
];

const NAME_EMOJI_GUESS = [
  { match: /grandmother|grandma|bunica/i, emoji: '👵' },
  { match: /grandfather|grandpa|bunic\b/i, emoji: '👴' },
  { match: /mother|mom|mum|mama|mamica/i, emoji: '👩' },
  { match: /father|dad|tata|tatic/i, emoji: '👨' },
  { match: /brother|frate/i, emoji: '👦' },
  { match: /sister|sora/i, emoji: '👧' },
  { match: /baby|bebe/i, emoji: '👶' },
  { match: /boss|manager|client|work|office/i, emoji: '💼' },
  { match: /friend|prieten|buddy/i, emoji: '🤝' },
  { match: /coach|trainer|sport|karate|gym/i, emoji: '🥋' },
  { match: /doctor|medic/i, emoji: '🩺' },
  { match: /haruto/i, emoji: '🥋' },
];

export function suggestEmoji(name) {
  if (!name) return null;
  for (const { match, emoji } of NAME_EMOJI_GUESS) {
    if (match.test(name)) return emoji;
  }
  return null;
}

function processAvatarFile(file, callback) {
  if (!file || !file.type.startsWith('image/')) return;
  if (typeof FileReader === 'undefined') return;
  const reader = new FileReader();
  reader.onload = (e) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      callback(e.target.result);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx2d = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx2d.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        callback(dataUrl);
      } catch {
        callback(e.target.result);
      }
    };
    img.onerror = () => callback(e.target.result);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

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

const GROUP_ICONS = {
  Family: '👨‍👩‍👧‍👦',
  Work: '💼',
  Friends: '🤝',
  Clients: '🏢',
  Other: '👥',
};
const groupIcon = (g) => GROUP_ICONS[g] || '👥';

function badge(r) {
  const plus = fmtOwes(r.owes, 1);
  const minus = fmtOwes(r.owes, -1);
  return `${plus ? `<span class="pp-badge in">↙ Owes you ${esc(plus)}</span>` : ''}${minus ? `<span class="pp-badge out">↗ You owe ${esc(minus)}</span>` : ''}`;
}

function card(r, y) {
  const p = r.person;
  const max = Math.max(1, r.received, r.given);
  const openEntries = Object.entries(r.owes).filter(([, v]) => v !== 0);
  const primaryOpen = openEntries[0];
  const hasOpen = Boolean(primaryOpen);
  const primaryKind = primaryOpen ? (primaryOpen[1] > 0 ? 'back-in' : 'back-out') : 'lent';
  const primaryAmt = primaryOpen ? Math.abs(primaryOpen[1]) : 0;
  const primaryCur = primaryOpen ? primaryOpen[0] : (p.currency || ctx.state.settings.currency);

  const netFlow = r.received - r.given;
  const netLabel = netFlow > 0 ? `+${ctx.money(netFlow)} received` : (netFlow < 0 ? `−${ctx.money(Math.abs(netFlow))} given` : 'Balanced');
  const netClass = netFlow > 0 ? 'income' : (netFlow < 0 ? 'expense' : 'muted');

  const owesPlus = fmtOwes(r.owes, 1);
  const owesMinus = fmtOwes(r.owes, -1);
  const debtBadge = owesPlus
    ? `<span class="pp-badge in">↙ Owes you ${esc(owesPlus)}</span>`
    : (owesMinus ? `<span class="pp-badge out">↗ You owe ${esc(owesMinus)}</span>` : '');

  const debtCardClass = owesPlus ? 'has-debt debt-in' : (owesMinus ? 'has-debt debt-out' : '');

  return `<div class="pp-card ${debtCardClass}" style="--pc:${colorOf(p)}">
    <div class="pp-top" data-act="person-open" data-id="${esc(p.id)}" style="cursor:pointer" title="Click to view details and customize icon/photo">
      ${personAvatar(p)}
      <div class="pp-name">
        <div class="pp-title-row">
          <b>${esc(p.name)}</b>
          ${hasOpen ? `<span class="pp-tag-debt ${primaryOpen[1] > 0 ? 'in' : 'out'}">${primaryOpen[1] > 0 ? '↙ Owes you' : '↗ You owe'}</span>` : ''}
        </div>
        <span class="pp-meta">${esc([p.note, p.currency && p.currency !== ctx.state.settings.currency ? p.currency : ''].filter(Boolean).join(' · ') || (r.last ? `Last active ${dayLabel(r.last)}` : 'No records yet'))}</span>
      </div>
    </div>
    ${debtBadge ? `<div class="pp-debt-callout ${primaryOpen && primaryOpen[1] > 0 ? 'in' : 'out'}">${debtBadge}</div>` : ''}
    <div class="pp-flow">
      <div class="pp-flow-head">
        <span class="pp-flow-label">Financial flow</span>
        <span class="pp-net ${netClass}">Net: ${netLabel}</span>
      </div>
      <div class="pp-row"><span>Received</span><b class="income">${r.received ? ctx.money(r.received) : '–'}</b></div>
      <div class="pp-bar"><i class="in" style="width:${(r.received / max) * 100}%"></i></div>
      <div class="pp-row"><span>Given</span><b>${r.given ? ctx.money(r.given) : '–'}</b></div>
      <div class="pp-bar"><i class="out" style="width:${(r.given / max) * 100}%"></i></div>
    </div>
    <div class="pp-foot">
      <span>${r.count} record${r.count === 1 ? '' : 's'}</span>
      ${y && (y.received || y.given) ? `<span>${todayISO().slice(0, 4)}: +${ctx.money(y.received)} / −${ctx.money(y.given)}</span>` : ''}
    </div>
    <div class="pp-card-actions">
      ${hasOpen ? `<button type="button" class="btn sm primary" data-act="settle-quick" data-id="${esc(p.id)}" data-kind="${primaryKind}" data-amt="${primaryAmt}" data-cur="${esc(primaryCur)}" title="1-click settle debt">⚡ Settle</button>` : ''}
      <button type="button" class="btn sm" data-act="loan-with" data-id="${esc(p.id)}" title="Record loan or payback">+ Loan</button>
      <button type="button" class="btn sm" data-act="tx-with" data-id="${esc(p.id)}" data-name="${esc(p.name)}" title="Log transaction">+ Log</button>
      <button type="button" class="btn sm" data-act="person-open" data-id="${esc(p.id)}" title="Open history & profile">Details</button>
    </div>
  </div>`;
}

function tableView(rs) {
  const groupOf = (p) => p.group || guessGroup(p);
  return `<div class="pp-table-card card">
    <table class="pp-table">
      <thead>
        <tr>
          <th>Contact</th>
          <th>Group</th>
          <th>Active Debt / Loan</th>
          <th class="num">Received</th>
          <th class="num">Given</th>
          <th class="num">Net Standing</th>
          <th>Last Active</th>
          <th class="actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rs.map((r) => {
          const p = r.person;
          const openEntries = Object.entries(r.owes).filter(([, v]) => v !== 0);
          const primaryOpen = openEntries[0];
          const hasOpen = Boolean(primaryOpen);
          const primaryKind = primaryOpen ? (primaryOpen[1] > 0 ? 'back-in' : 'back-out') : 'lent';
          const primaryAmt = primaryOpen ? Math.abs(primaryOpen[1]) : 0;
          const primaryCur = primaryOpen ? primaryOpen[0] : (p.currency || ctx.state.settings.currency);
          const netFlow = r.received - r.given;
          const netClass = netFlow > 0 ? 'income' : (netFlow < 0 ? 'expense' : 'muted');

          return `<tr>
            <td>
              <div class="pp-tbl-contact" data-act="person-open" data-id="${esc(p.id)}" title="View details and customize icon/photo">
                ${personAvatar(p, { size: 'sm' })}
                <div class="pp-tbl-name">
                  <b>${esc(p.name)}</b>
                  ${p.note ? `<small>${esc(p.note)}</small>` : ''}
                </div>
              </div>
            </td>
            <td><span class="pp-group-tag">${groupIcon(groupOf(p))} ${esc(groupOf(p))}</span></td>
            <td>${badge(r) || '<span class="muted small">Settled ✓</span>'}</td>
            <td class="num income">${r.received ? ctx.money(r.received) : '–'}</td>
            <td class="num">${r.given ? ctx.money(r.given) : '–'}</td>
            <td class="num ${netClass}"><b>${netFlow !== 0 ? (netFlow > 0 ? '+' : '−') + ctx.money(Math.abs(netFlow)) : '0'}</b></td>
            <td class="small muted">${r.last ? dayLabel(r.last) : '–'}</td>
            <td class="actions">
              <div class="btns-inline">
                ${hasOpen ? `<button type="button" class="btn sm primary" data-act="settle-quick" data-id="${esc(p.id)}" data-kind="${primaryKind}" data-amt="${primaryAmt}" data-cur="${esc(primaryCur)}">⚡ Settle</button>` : ''}
                <button type="button" class="btn sm" data-act="loan-with" data-id="${esc(p.id)}">+ Loan</button>
                <button type="button" class="btn sm" data-act="person-open" data-id="${esc(p.id)}">Details</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function groupSection(g, rs, thisYearMap, isCollapsed) {
  const gReceived = rs.reduce((a, r) => a + r.received, 0);
  const gGiven = rs.reduce((a, r) => a + r.given, 0);
  const gNet = gReceived - gGiven;
  const gDebts = rs.filter((r) => Object.keys(r.owes).length > 0).length;

  return `<section class="pp-group ${isCollapsed ? 'collapsed' : ''}">
    <header class="pp-group-header" data-act="people-toggle-group" data-group="${esc(g)}" title="Click to collapse / expand">
      <div class="pp-gh-left">
        <span class="pp-gh-toggle">${isCollapsed ? '▶' : '▼'}</span>
        <span class="pp-gh-icon">${groupIcon(g)}</span>
        <h2 class="pp-gh-title">${esc(g)}</h2>
        <span class="pp-gh-count">${rs.length} contact${rs.length === 1 ? '' : 's'}</span>
      </div>
      <div class="pp-gh-right">
        <span class="pp-gh-flow">Net: <b class="${gNet >= 0 ? 'income' : 'expense'}">${gNet >= 0 ? '+' : '−'}${ctx.money(Math.abs(gNet))}</b></span>
        ${gDebts ? `<span class="pill pill-gold">${gDebts} active debt${gDebts === 1 ? '' : 's'}</span>` : `<span class="pill pill-soft">Settled ✓</span>`}
      </div>
    </header>
    ${isCollapsed ? '' : `<div class="pp-grid">${rs.map((r) => card(r, thisYearMap.get(r.person.id))).join('')}</div>`}
  </section>`;
}

export function view() {
  const { state, ui } = ctx;
  const year = todayISO().slice(0, 4);
  const all = M.peopleSummary(state);
  const thisYear = new Map(M.peopleSummary(state, { from: `${year}-01-01` }).map((r) => [r.person.id, r]));
  const q = (ui.peopleSearch || '').trim().toLowerCase();
  const groupOf = (p) => p.group || guessGroup(p);
  const groups = [...new Set([...M.PERSON_GROUPS, ...state.people.map(groupOf)])].filter((g) => state.people.some((p) => groupOf(p) === g));

  // Collect all active open loans
  const openLoans = [];
  for (const r of all) {
    for (const [cur, v] of Object.entries(r.owes)) {
      if (v !== 0) {
        openLoans.push({
          person: r.person,
          currency: cur,
          amount: Math.abs(v),
          direction: v > 0 ? 'owed_to_me' : 'i_owe',
          rawVal: v,
          last: r.last,
        });
      }
    }
  }

  const pick = ui.peopleGroup || 'all';
  const sortMode = ui.peopleSort || 'debts';
  const viewMode = ui.peopleView || 'grid';
  const collapsed = ui.peopleCollapsed || new Set();

  let rows = all.filter((r) => {
    const matchesQ = !q || `${r.person.name} ${r.person.note || ''}`.toLowerCase().includes(q);
    if (!matchesQ) return false;
    if (pick === 'open-loans') return Object.keys(r.owes).length > 0;
    if (pick === 'i-owe') return Object.values(r.owes).some((v) => v < 0);
    if (pick === 'all') return true;
    return groupOf(r.person) === pick;
  });

  // Sort rows
  rows.sort((a, b) => {
    if (sortMode === 'debts') {
      const aDebt = Object.values(a.owes).some((v) => v !== 0) ? 1 : 0;
      const bDebt = Object.values(b.owes).some((v) => v !== 0) ? 1 : 0;
      if (aDebt !== bDebt) return bDebt - aDebt;
      return (b.last || '').localeCompare(a.last || '');
    }
    if (sortMode === 'recent') {
      return (b.last || '').localeCompare(a.last || '');
    }
    if (sortMode === 'flow') {
      return (b.received + b.given) - (a.received + a.given);
    }
    if (sortMode === 'name') {
      return a.person.name.localeCompare(b.person.name);
    }
    return 0;
  });

  // Totals per currency
  const owed = {};
  const iOwe = {};
  for (const r of all) {
    for (const [cur, v] of Object.entries(r.owes)) {
      (v > 0 ? owed : iOwe)[cur] = ((v > 0 ? owed : iOwe)[cur] || 0) + Math.abs(v);
    }
  }

  const baseCur = state.settings.currency;
  const inBase = (cents, cur) => (cur === baseCur ? cents : convert(cents, cur, baseCur, state.rates) ?? cents);
  let netCents = 0;
  for (const l of openLoans) {
    const b = inBase(l.amount, l.currency);
    netCents += l.direction === 'owed_to_me' ? b : -b;
  }

  const yr = [...thisYear.values()];
  const received = yr.reduce((a, r) => a + r.received, 0);
  const given = yr.reduce((a, r) => a + r.given, 0);

  const sections = viewMode === 'table'
    ? tableView(rows)
    : (pick === 'all' && !q
      ? groups.map((g) => {
          const rs = rows.filter((r) => groupOf(r.person) === g);
          return rs.length ? groupSection(g, rs, thisYear, collapsed.has(g)) : '';
        }).join('')
      : `<div class="pp-grid">${rows.map((r) => card(r, thisYear.get(r.person.id))).join('')}</div>`);

  const tot = (o) => Object.entries(o).map(([cur, v]) => `<b>${esc(formatMoney(v, cur))}</b>`).join('<span class="muted"> · </span>') || `<b>0 ${esc(baseCur)}</b>`;

  const openOwedCount = openLoans.filter((l) => l.direction === 'owed_to_me').length;
  const openDebtCount = openLoans.filter((l) => l.direction === 'i_owe').length;

  return `<header class="top">
    <div>
      <h1>People & loans</h1>
      <div class="sub">Who gave you money, who you gave to, debts & loan settlements</div>
    </div>
    <div class="btns-inline">
      <button class="btn" data-act="loan-new" data-kind="lent">+ Lend money</button>
      <button class="btn" data-act="loan-new" data-kind="borrowed">+ Borrow money</button>
      <button class="btn primary" data-act="person-new">+ Add person</button>
    </div>
  </header>

  <section class="pp-sum">
    <div class="pp-tile clickable ${Object.keys(owed).length ? 'highlight-in' : ''} ${pick === 'open-loans' ? 'active' : ''}" data-act="people-group" data-group="open-loans" title="Click to filter contacts who owe you">
      <div class="pp-tile-head"><span>Owed to you</span><span class="pp-tile-icon">📥</span></div>
      <div class="pp-big income">${tot(owed)}</div>
      <div class="pp-tile-sub">${openOwedCount ? `${openOwedCount} contact${openOwedCount === 1 ? '' : 's'} owe you →` : 'All clear ✨'}</div>
    </div>
    <div class="pp-tile clickable ${Object.keys(iOwe).length ? 'highlight-out' : ''} ${pick === 'i-owe' ? 'active' : ''}" data-act="people-group" data-group="i-owe" title="Click to filter debts you owe">
      <div class="pp-tile-head"><span>You owe (debts)</span><span class="pp-tile-icon">📤</span></div>
      <div class="pp-big ${Object.keys(iOwe).length ? 'expense' : ''}">${Object.keys(iOwe).length ? tot(iOwe) : `<b>0 ${esc(baseCur)}</b>`}</div>
      <div class="pp-tile-sub">${openDebtCount ? `${openDebtCount} debt${openDebtCount === 1 ? '' : 's'} to settle →` : 'Debt-free 🎉'}</div>
    </div>
    <div class="pp-tile">
      <div class="pp-tile-head"><span>Net loan balance</span><span class="pp-tile-icon">⚖️</span></div>
      <div class="pp-big ${netCents > 0 ? 'income' : netCents < 0 ? 'expense' : ''}">${netCents === 0 ? `0 ${esc(baseCur)}` : `${netCents > 0 ? '+' : '−'}${formatMoney(Math.abs(netCents), baseCur)}`}</div>
      <div class="pp-tile-sub">${netCents > 0 ? 'Net creditor position' : netCents < 0 ? 'Net debts to pay back' : 'Balanced ✨'}</div>
    </div>
    <div class="pp-tile clickable ${pick === 'all' ? 'active' : ''}" data-act="people-group" data-group="all" title="Click to show all contacts">
      <div class="pp-tile-head"><span>Contacts & flows</span><span class="pp-tile-icon">👥</span></div>
      <div class="pp-big">${all.length} <small style="font-size:13px;font-weight:normal;color:var(--muted)">contact${all.length === 1 ? '' : 's'}</small></div>
      <div class="pp-tile-sub">${year}: +${formatMoney(received, baseCur, { compact: true })} / −${formatMoney(given, baseCur, { compact: true })}</div>
    </div>
  </section>

  <section class="loans-hub">
    <div class="loans-hub-head">
      <div class="loans-hub-title">
        <span>⚡ Open Loans & Debts Hub</span>
        ${openLoans.length ? `<span class="pill pill-gold">${openLoans.length} active</span>` : ''}
      </div>
      <div class="loans-hub-actions">
        <button class="btn sm" data-act="loan-new" data-kind="lent">+ Lend money</button>
        <button class="btn sm" data-act="loan-new" data-kind="borrowed">+ Borrow money</button>
      </div>
    </div>
    ${openLoans.length ? `
      <div class="loans-grid">
        ${openLoans.map((l) => `
          <div class="open-loan-card ${l.direction === 'owed_to_me' ? 'incoming' : 'outgoing'}">
            <div class="olc-top">
              ${personAvatar(l.person, { size: 'sm' })}
              <div class="olc-meta">
                <button type="button" class="olc-name" data-act="person-open" data-id="${esc(l.person.id)}"><b>${esc(l.person.name)}</b></button>
                <span class="olc-group">${groupIcon(groupOf(l.person))} ${esc(groupOf(l.person))}${l.last ? ` · last ${dayLabel(l.last)}` : ''}</span>
              </div>
              <span class="olc-pill ${l.direction === 'owed_to_me' ? 'pill-in' : 'pill-out'}">
                ${l.direction === 'owed_to_me' ? '↙ Owes you' : '↗ You owe'}
              </span>
            </div>
            <div class="olc-amount ${l.direction === 'owed_to_me' ? 'income' : 'expense'}">
              ${l.direction === 'owed_to_me' ? '+' : '−'}${formatMoney(l.amount, l.currency)}
            </div>
            <div class="olc-actions">
              <button type="button" class="btn sm primary" data-act="settle-quick" data-id="${esc(l.person.id)}" data-kind="${l.direction === 'owed_to_me' ? 'back-in' : 'back-out'}" data-amt="${l.amount}" data-cur="${esc(l.currency)}">
                ⚡ Settle / Pay back
              </button>
              <button type="button" class="btn sm" data-act="loan-with" data-id="${esc(l.person.id)}">
                + Add loan
              </button>
              <button type="button" class="btn sm" data-act="tx-with" data-id="${esc(l.person.id)}" data-name="${esc(l.person.name)}">
                Log tx
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="open-loans-settled">
        <span class="ols-icon">✨</span>
        <div><b>All loans and debts are settled</b><span>Nobody owes you money, and you don't owe anyone. Clean slate!</span></div>
        <div class="btns-inline">
          <button class="btn sm" data-act="loan-new" data-kind="lent">+ Record a loan</button>
        </div>
      </div>
    `}
  </section>

  <div class="pp-tools">
    <div class="pp-search-box">
      <input type="search" id="people-search" placeholder="Find by name, note, or group..." value="${esc(ui.peopleSearch || '')}" aria-label="Find a person">
      ${ui.peopleSearch ? '<button type="button" class="pp-search-clear" data-act="people-clear-search" aria-label="Clear search">✕</button>' : ''}
    </div>
    <div class="chips pp-filter-chips">
      <button class="chip ${pick === 'all' ? 'active' : ''}" data-act="people-group" data-group="all" aria-pressed="${pick === 'all'}">All (${all.length})</button>
      ${openLoans.length ? `<button class="chip chip-gold ${pick === 'open-loans' ? 'active' : ''}" data-act="people-group" data-group="open-loans" aria-pressed="${pick === 'open-loans'}">⚡ Open debts (${openLoans.length})</button>` : ''}
      ${groups.map((g) => {
        const cnt = all.filter((r) => groupOf(r.person) === g).length;
        return `<button class="chip ${pick === g ? 'active' : ''}" data-act="people-group" data-group="${esc(g)}" aria-pressed="${pick === g}">${groupIcon(g)} ${esc(g)} (${cnt})</button>`;
      }).join('')}
    </div>
    <div class="pp-toolbar-right">
      <select class="pp-sort-select" data-act="people-sort" aria-label="Sort contacts">
        <option value="debts" ${sortMode === 'debts' ? 'selected' : ''}>Sort: Debts first</option>
        <option value="recent" ${sortMode === 'recent' ? 'selected' : ''}>Sort: Recently active</option>
        <option value="flow" ${sortMode === 'flow' ? 'selected' : ''}>Sort: Highest flow</option>
        <option value="name" ${sortMode === 'name' ? 'selected' : ''}>Sort: Name (A–Z)</option>
      </select>
      <div class="seg sm pp-view-toggle">
        <button type="button" data-act="people-view" data-view="grid" aria-pressed="${viewMode === 'grid'}" title="Card Grid view">🎴 Cards</button>
        <button type="button" data-act="people-view" data-view="table" aria-pressed="${viewMode === 'table'}" title="Table Ledger view">📋 Table</button>
      </div>
    </div>
  </div>

  ${rows.length ? sections : (all.length === 0 ? `
    <div class="pp-empty-state">
      <div class="ppe-icon">👥</div>
      <h3>Track people, loans & settlements</h3>
      <p>Keep track of friends, family, and colleagues who owe you money or who you borrowed from. Debts stay in their original currency.</p>
      <div class="ppe-cards">
        <button type="button" class="ppe-card" data-act="loan-new" data-kind="lent">
          <span class="ppe-badge">💸 Lend money</span>
          <b>I lent money to someone</b>
          <span>Track who owes you and settle in 1 tap</span>
        </button>
        <button type="button" class="ppe-card" data-act="loan-new" data-kind="borrowed">
          <span class="ppe-badge">🤝 Borrow money</span>
          <b>I borrowed money</b>
          <span>Track what you need to pay back</span>
        </button>
        <button type="button" class="ppe-card" data-act="person-new">
          <span class="ppe-badge">👤 New contact</span>
          <b>Add contact or family member</b>
          <span>Organize into Family, Friends, Work</span>
        </button>
      </div>
    </div>
  ` : `<div class="empty"><b>${q ? 'Nobody with that name' : 'No contacts in this filter'}</b>${q ? '' : 'Try choosing another group chip above.'}</div>`)}`;
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
  const openEntries = r ? Object.entries(r.owes).filter(([, v]) => v !== 0) : [];
  const primaryOpen = openEntries[0];
  const hasOpen = Boolean(primaryOpen);

  ctx.openSheet(`<h3>${personAvatar(p, { size: 'sm', cls: 'pp-sheet-av-header' })} ${esc(p.name)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    ${hasOpen ? `
      <div class="pp-settle-banner">
        <div><span>Active loan:</span> ${owesLine}</div>
        <button type="button" class="btn sm primary" data-p="quick-settle">⚡ Settle this debt</button>
      </div>
    ` : (owesLine ? `<div class="pp-badges" style="margin-bottom:12px">${owesLine}</div>` : '')}
    <div class="btns" style="margin-bottom:14px">
      <button class="btn primary" data-p="loan">+ Loan or payback</button>
      <button class="btn" data-p="income">${esc(p.name)} gave me</button>
      <button class="btn" data-p="expense">I gave ${esc(p.name)}</button>
    </div>

    <!-- Avatar, Photo & Icon Customizer -->
    <div class="pp-avatar-manager">
      <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
        <div class="pp-avatar-preview-wrap">
          <div id="pp-cur-avatar">${personAvatar(p, { size: 'lg' })}</div>
          <label for="p-file-input" class="pp-avatar-badge-btn" title="Upload photo or image">📷</label>
          <input type="file" id="p-file-input" accept="image/*" style="display:none;">
        </div>
        <div style="flex:1; min-width:200px; display:grid; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="small font-bold">Avatar, Photo & Icon</span>
            <div class="btns-inline">
              <button type="button" class="btn sm" id="p-btn-rm-img" style="color:var(--expense); ${p.image ? '' : 'display:none;'}">Remove photo</button>
              <button type="button" class="btn sm" id="p-btn-reset-av" style="${(p.image || p.emoji || p.color) ? '' : 'display:none;'}">Reset to default</button>
            </div>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <label class="btn sm primary" for="p-file-input" style="cursor:pointer; display:inline-flex; align-items:center; gap:5px; margin:0;">
              📷 Upload photo
            </label>
            <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:180px;">
              <input type="text" id="p-emoji-input" value="${esc(p.emoji || '')}" placeholder="Emoji" maxlength="4" style="width:65px; text-align:center; font-size:17px; padding:4px 6px;" title="Type or paste custom emoji">
              <input type="url" id="p-imgurl-input" value="${esc(p.image && !p.image.startsWith('data:') ? p.image : '')}" placeholder="Or paste image URL" style="flex:1; font-size:12px; padding:6px 8px;">
            </div>
          </div>
        </div>
      </div>

      <div class="pp-quick-emojis" style="margin-top:12px; padding-top:10px; border-top:1px solid var(--line);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span class="muted small">Quick icons:</span>
          <div class="pp-color-swatches" style="display:flex; gap:5px;">
            ${COLOR_PRESETS.map((c) => `
              <button type="button" class="pp-color-dot" data-color="${c.value}" style="background:${c.value}; border-color:${(p.color === c.value || colorOf(p) === c.value) ? '#fff' : 'transparent'};" title="${c.name}"></button>
            `).join('')}
          </div>
        </div>
        <div class="pp-emoji-palette">
          ${EMOJI_PALETTE.map((em) => `
            <button type="button" class="pp-emoji-btn ${p.emoji === em ? 'active' : ''}" data-set-emoji="${em}" title="Choose ${em}">
              ${em}
            </button>
          `).join('')}
        </div>
      </div>
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
      refreshAvatarPreview();
    };

    const refreshAvatarPreview = () => {
      const container = sheet.querySelector('#pp-cur-avatar');
      if (container) container.innerHTML = personAvatar(p, { size: 'lg' });
      const hdr = sheet.querySelector('.pp-sheet-av-header');
      if (hdr) hdr.outerHTML = personAvatar(p, { size: 'sm', cls: 'pp-sheet-av-header' });

      sheet.querySelectorAll('.pp-emoji-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.setEmoji === p.emoji);
      });
      const curCol = colorOf(p);
      sheet.querySelectorAll('.pp-color-dot').forEach((d) => {
        d.style.borderColor = (d.dataset.color === curCol) ? '#fff' : 'transparent';
      });
      const rmBtn = sheet.querySelector('#p-btn-rm-img');
      if (rmBtn) rmBtn.style.display = p.image ? 'inline-block' : 'none';
      const resetBtn = sheet.querySelector('#p-btn-reset-av');
      if (resetBtn) resetBtn.style.display = (p.image || p.emoji || p.color) ? 'inline-block' : 'none';

      const emInp = sheet.querySelector('#p-emoji-input');
      if (emInp && document.activeElement !== emInp) emInp.value = p.emoji || '';
      const urlInp = sheet.querySelector('#p-imgurl-input');
      if (urlInp && document.activeElement !== urlInp) urlInp.value = (p.image && !p.image.startsWith('data:')) ? p.image : '';
    };

    const fileInput = sheet.querySelector('#p-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        processAvatarFile(file, (dataUrl) => {
          p.image = dataUrl;
          M.touch(p);
          ctx.commit();
          refreshAvatarPreview();
          ctx.toast('Photo updated');
        });
      });
    }

    const emojiInput = sheet.querySelector('#p-emoji-input');
    if (emojiInput) {
      emojiInput.addEventListener('input', () => {
        const val = emojiInput.value.trim();
        p.emoji = val;
        if (val) delete p.image;
        M.touch(p);
        ctx.commit();
        refreshAvatarPreview();
      });
    }

    const urlInput = sheet.querySelector('#p-imgurl-input');
    if (urlInput) {
      urlInput.addEventListener('change', () => {
        const val = urlInput.value.trim();
        if (val) {
          p.image = val;
          delete p.emoji;
          M.touch(p);
          ctx.commit();
          refreshAvatarPreview();
        }
      });
    }

    for (const sel of ['#p-name', '#p-note', '#p-group', '#p-cur']) sheet.querySelector(sel).addEventListener('change', save);
    sheet.addEventListener('click', (e) => {
      const em = e.target.closest('[data-set-emoji]');
      if (em) {
        p.emoji = em.dataset.setEmoji;
        delete p.image;
        M.touch(p);
        ctx.commit();
        refreshAvatarPreview();
        return;
      }
      const colBtn = e.target.closest('[data-color]');
      if (colBtn) {
        p.color = colBtn.dataset.color;
        M.touch(p);
        ctx.commit();
        refreshAvatarPreview();
        return;
      }
      if (e.target.closest('#p-btn-rm-img')) {
        delete p.image;
        M.touch(p);
        ctx.commit();
        refreshAvatarPreview();
        return;
      }
      if (e.target.closest('#p-btn-reset-av')) {
        delete p.image;
        delete p.emoji;
        delete p.color;
        M.touch(p);
        ctx.commit();
        refreshAvatarPreview();
        return;
      }

      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); return; }
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const k = b.dataset.p;
      if (k === 'quick-settle') {
        ctx.closeSheet();
        if (primaryOpen) {
          setTimeout(() => openLoan(id, {
            kind: primaryOpen[1] > 0 ? 'back-in' : 'back-out',
            amount: Math.abs(primaryOpen[1]),
            currency: primaryOpen[0],
          }), 200);
        }
        return;
      }
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

function openLoan(personId = null, opts = {}) {
  const { state } = ctx;
  const people = [...state.people].sort((a, b) => a.name.localeCompare(b.name));
  let pid = personId || people[0]?.id || '';
  const r0 = () => M.peopleSummary(state).find((x) => x.person.id === pid);
  const openEntries = r0() ? Object.entries(r0().owes).filter(([, v]) => v !== 0) : [];
  const primaryOpen = openEntries[0];
  let kind = opts.kind || (primaryOpen ? (primaryOpen[1] > 0 ? 'back-in' : 'back-out') : 'lent');
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const curOf = () => opts.currency || primaryOpen?.[0] || M.person(state, pid)?.currency || state.settings.currency;
  const accFor = (cur) => accs.find((a) => a.currency === cur)?.id || accs[0]?.id;
  const initAmt = opts.amount != null ? centsToPlain(opts.amount) : (primaryOpen && (kind === 'back-in' || kind === 'back-out') ? centsToPlain(Math.abs(primaryOpen[1])) : '');

  ctx.openSheet(`<h3>Loan or payback <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="loan-form" autocomplete="off">
      <div class="seg loan-kinds" role="group" aria-label="What happened">${KINDS.map((k) => `<button type="button" data-kind="${k.id}" aria-pressed="${k.id === kind}">${k.label}</button>`).join('')}</div>
      <label class="field"><span>Who</span><input id="loan-who" type="text" list="loan-people" value="${esc(M.person(state, pid)?.name || '')}" placeholder="Name" required><datalist id="loan-people">${people.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></label>
      <div class="row2">
        <label class="field"><span>Amount</span><input id="loan-amt" type="text" inputmode="decimal" placeholder="0" value="${esc(initAmt)}" required></label>
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
      hint();
    });
    $('#loan-cur').addEventListener('change', () => { $('#loan-acc').value = accFor($('#loan-cur').value); hint(); });
    for (const s of ['#loan-amt', '#loan-acc', '#loan-who']) $(s).addEventListener('input', hint);
    hint();
    setTimeout(() => $(initAmt ? '#loan-amt' : (pid ? '#loan-amt' : '#loan-who')).focus(), 50);
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
  let newEmoji = '';
  let newImage = '';
  let newColor = '';

  ctx.openSheet(`<h3>Add contact or person <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="p-form">
      <div style="display:flex; gap:14px; align-items:center; margin-bottom:14px; background:var(--surface-2); padding:12px; border-radius:var(--radius); border:1px solid var(--line);">
        <div class="pp-avatar-preview-wrap">
          <div id="p-new-av-prev">${personAvatar({ name: '?', color: 'var(--c1)' }, { size: 'lg' })}</div>
          <label for="p-new-file" class="pp-avatar-badge-btn" title="Upload photo">📷</label>
          <input type="file" id="p-new-file" accept="image/*" style="display:none;">
        </div>
        <div style="flex:1; min-width:180px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span class="small font-bold">Icon or Photo</span>
            <div class="pp-color-swatches" style="display:flex; gap:4px;">
              ${COLOR_PRESETS.slice(0, 6).map((c) => `
                <button type="button" class="pp-color-dot" data-new-color="${c.value}" style="background:${c.value};" title="${c.name}"></button>
              `).join('')}
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <label class="btn sm primary" for="p-new-file" style="cursor:pointer; margin:0; font-size:12px;">📷 Upload</label>
            <input type="text" id="p-new-emoji" placeholder="Emoji" maxlength="4" style="width:65px; text-align:center; font-size:16px; padding:4px;">
            <span class="muted small" id="p-new-suggest-hint" style="flex:1; font-size:11.5px;">Auto-suggests from name</span>
          </div>
        </div>
      </div>

      <!-- Quick emoji row -->
      <div class="pp-emoji-palette" style="margin-bottom:14px;">
        ${['👩', '👨', '👵', '👴', '👦', '👧', '👶', '💼', '🧑‍💻', '🤝', '😎', '🏠', '🥋', '👑'].map((em) => `
          <button type="button" class="pp-emoji-btn" data-new-emoji="${em}">${em}</button>
        `).join('')}
      </div>

      <label class="field"><span>Name</span><input id="p-new" type="text" placeholder="e.g. Mom, Brother, Haruto, US client" required></label>
      <div class="row2">
        <label class="field"><span>Group</span><select id="p-new-group">${groups.map((g) => `<option>${esc(g)}</option>`).join('')}</select></label>
        <label class="field"><span>Usual currency</span><select id="p-new-cur">${currencies().map((c) => `<option>${c}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Note (optional)</span><input id="p-new-note" type="text" placeholder="e.g. brother, client from the US"></label>
      <div class="btns"><button class="btn primary" type="submit">Add person</button></div>
    </form>`, (sheet) => {
    const nameInput = sheet.querySelector('#p-new');
    const emojiInput = sheet.querySelector('#p-new-emoji');
    const hintEl = sheet.querySelector('#p-new-suggest-hint');

    const updatePreview = () => {
      const mockPerson = {
        name: nameInput.value.trim() || '?',
        emoji: newEmoji || undefined,
        image: newImage || undefined,
        color: newColor || 'var(--c1)',
      };
      const prevWrap = sheet.querySelector('.pp-avatar-preview-wrap');
      if (prevWrap) {
        const curPrev = prevWrap.querySelector('.pp-av');
        if (curPrev) curPrev.outerHTML = personAvatar(mockPerson, { size: 'lg' });
      }
      sheet.querySelectorAll('[data-new-emoji]').forEach((b) => {
        b.classList.toggle('active', b.dataset.newEmoji === newEmoji);
      });
    };

    const fileInput = sheet.querySelector('#p-new-file');
    if (fileInput) {
      fileInput.addEventListener('change', (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        processAvatarFile(file, (dataUrl) => {
          newImage = dataUrl;
          newEmoji = '';
          emojiInput.value = '';
          updatePreview();
        });
      });
    }

    emojiInput.addEventListener('input', () => {
      newEmoji = emojiInput.value.trim();
      newImage = '';
      updatePreview();
    });

    sheet.addEventListener('click', (e) => {
      const em = e.target.closest('[data-new-emoji]');
      if (em) {
        newEmoji = em.dataset.newEmoji;
        newImage = '';
        emojiInput.value = newEmoji;
        updatePreview();
        return;
      }
      const col = e.target.closest('[data-new-color]');
      if (col) {
        newColor = col.dataset.newColor;
        updatePreview();
        return;
      }
    });

    nameInput.addEventListener('input', () => {
      const val = nameInput.value.trim();
      if (!newEmoji && !newImage) {
        const guessed = suggestEmoji(val);
        if (guessed) {
          newEmoji = guessed;
          emojiInput.value = guessed;
          if (hintEl) hintEl.textContent = `Suggested ${guessed}`;
        }
      }
      updatePreview();
    });

    nameInput.focus();
    sheet.querySelector('#p-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = M.ensurePerson(ctx.state, nameInput.value);
      if (!id) return;
      const p = M.person(ctx.state, id);
      Object.assign(p, {
        note: sheet.querySelector('#p-new-note').value.trim(),
        group: sheet.querySelector('#p-new-group').value,
        currency: sheet.querySelector('#p-new-cur').value,
        emoji: newEmoji || undefined,
        image: newImage || undefined,
        color: newColor || undefined,
      });
      M.touch(p);
      ctx.commit();
      ctx.closeSheet();
    });
  });
}

export function onClick(act, el) {
  if (act === 'person-open') { openPerson(el.dataset.id); return true; }
  if (act === 'person-new') { addPerson(); return true; }
  if (act === 'loan-new') { openLoan(null, { kind: el.dataset.kind || 'lent' }); return true; }
  if (act === 'loan-with') { openLoan(el.dataset.id); return true; }
  if (act === 'tx-with') { ctx.openTxSheet(null, { personName: el.dataset.name }); return true; }
  if (act === 'settle-quick') {
    openLoan(el.dataset.id, {
      kind: el.dataset.kind,
      amount: Number(el.dataset.amt),
      currency: el.dataset.cur,
    });
    return true;
  }
  if (act === 'people-group') { ctx.ui.peopleGroup = el.dataset.group; ctx.render(); return true; }
  if (act === 'people-view') { ctx.ui.peopleView = el.dataset.view; ctx.render(); return true; }
  if (act === 'people-clear-search') { ctx.ui.peopleSearch = ''; ctx.render(); return true; }
  if (act === 'people-toggle-group') {
    if (!ctx.ui.peopleCollapsed) ctx.ui.peopleCollapsed = new Set();
    const g = el.dataset.group;
    if (ctx.ui.peopleCollapsed.has(g)) ctx.ui.peopleCollapsed.delete(g);
    else ctx.ui.peopleCollapsed.add(g);
    ctx.render();
    return true;
  }
  return false;
}

export function onChange(el) {
  if (el.dataset.act === 'people-sort') {
    ctx.ui.peopleSort = el.value;
    ctx.render();
    return true;
  }
  return false;
}

export function onInput(el) {
  if (el.id !== 'people-search') return false;
  ctx.ui.peopleSearch = el.value;
  const pos = el.selectionStart;
  ctx.render();
  const s = document.getElementById('people-search');
  s?.focus();
  s?.setSelectionRange(pos, pos);
  return true;
}

export { openPerson, openLoan };
