// Telegram bot in the app: logs what you send ("coffee 35"), answers
// /today, /balance and /undo, and sends reminders (evening "time to log",
// bills due) to your own bot. The desktop main process moves the messages
// (electron/telegram.cjs); text parsing lives in js/telegram.js.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as T from '../telegram.js';
import { todayISO, weekday, DOW_LONG } from '../dates.js';
import { weeklyReview, cashAccounts, cashCheck } from '../review.js';
import { evalAmount } from '../money.js';
import * as Blocks from '../blocks.js';
import { safeLine } from '../safespend.js';
import { formatMoney } from '../money.js';

const bot = () => window.desktop?.telegram;
const bg = () => window.desktop?.background;
const st = { status: null, pair: null, busy: false, error: '', bg: null, relay: { busy: false, error: '', copied: false, script: '', open: false } };
// open: false | 'google' | 'server'
const prefs = () => ({ daily: true, at: '21:00', bills: true, weekly: true, weeklyDay: 0, weeklyAt: '19:00', cash: true, ...(ctx.state.meta.tg || {}) });

// The Sunday ritual: the week, records to file, then the cash check.
async function sendWeekly() {
  const { state } = ctx;
  const today = todayISO();
  const r = weeklyReview(state, today);
  await send(T.weeklyText(state, r), keyboard());
  for (const t of r.other) {
    const m = T.fixMessage(state, t);
    await send(m.text, m.extra);
  }
  if (prefs().cash) askCash();
}

function askCash() {
  const acc = cashAccounts(ctx.state)[0];
  if (!acc) return;
  ctx.state.meta.tgAwait = { kind: 'cash', account: acc.id, until: Date.now() + 18 * 3600000 };
  ctx.persist();
  send(T.cashQuestion(acc.name), { reply_markup: { force_reply: true, input_field_placeholder: 'e.g. 1240' } });
}

// A block without a fixed amount asked "how much?": the next number logs it.
function amountReply(text, u, logIt) {
  const w = ctx.state.meta.tgAwait;
  if (w?.kind !== 'amount' || Date.now() > w.until || !/^\s*[\d\s.,+\-*/()x×]+\s*(lei|mdl)?\s*$/i.test(text)) return false;
  const amount = evalAmount(text.replace(/lei|mdl/i, '').replace(/\s+/g, ''));
  const b = Blocks.blocks(ctx.state).find((x) => x.id === w.block);
  ctx.state.meta.tgAwait = null;
  if (!b || !amount || amount <= 0) return false;
  logIt({ ...Blocks.blockFields(ctx.state, b), amount });
  return true;
}

// The categories to offer under a record logged with no description.
function categoryButtons(t) {
  const used = {};
  for (const x of ctx.state.tx) if (x.type === t.type) used[x.category] = (used[x.category] || 0) + 1;
  const cats = ctx.state.settings.categories.filter((c) => c.type === t.type && c.id !== 'other' && c.id !== 'other-in')
    .sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0)).slice(0, 6);
  const rows = [];
  for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i + 3).map((c) => ({ text: `${c.emoji || ''} ${c.name}`.trim(), callback_data: `cat:${t.id}:${c.id}` })));
  rows.push([{ text: '↩️ Undo', callback_data: `undo:${t.id}` }]);
  return rows;
}

// A plain number while a cash check is open settles it.
function cashReply(text, u) {
  const w = ctx.state.meta.tgAwait;
  if (w?.kind !== 'cash' || Date.now() > w.until || !/^\s*[\d\s.,+]+\s*(lei|mdl)?\s*$/i.test(text)) return false;
  const counted = evalAmount(text.replace(/lei|mdl/i, '').replace(/\s+/g, ''));
  if (counted == null) return false;
  const acc = M.account(ctx.state, w.account);
  const r = cashCheck(ctx.state, w.account, counted, { date: localDay(u.message.date), id: `cc-${u.update_id}` });
  if (r.tx) ctx.state.tx.push(r.tx);
  ctx.state.meta.tgAwait = null;
  ctx.state.meta.lastCashCheck = todayISO();
  send(T.cashAnswer(ctx.state, r, acc?.name || 'Cash'));
  return true;
}

function refresh() {
  const el = document.getElementById('tg-card');
  if (el) el.outerHTML = settingsCard();
}

// Why the bot can't work right now, in words (null when it's fine).
export function alertText() {
  const s = st.status;
  if (!s?.connected) return null;
  if (s.errorCode === 'token') return 'Telegram bot stopped: its token was revoked or changed. Paste the new token.';
  if (s.errorCode === 'conflict') return 'Telegram bot: another program or a second copy of the app is reading it. Close it.';
  if (s.errorCode === 'network' && Date.now() - (s.lastCheck || 0) > 10 * 60000) return 'Telegram bot: no connection to Telegram for a while (internet?).';
  if (!s.linked) return 'Telegram bot: link your account to finish (Settings → Telegram).';
  if (s.server?.on && s.server.error && Date.now() - (s.server.okAt || 0) > 5 * 60000) return 'Telegram bot: your server doesn\'t answer. Messages wait there; check it (Settings → Telegram).';
  const r = s.relay;
  if (r?.on && r.error && Date.now() - (r.okAt || 0) > 10 * 60000) return 'Telegram always-on: the Google script doesn\'t answer. Check it in Settings → Telegram.';
  if (r?.on && r.okAt && !r.trigger) return 'Telegram always-on is paused: Google isn\'t checking your bot. See Settings → Telegram.';
  return null;
}

function paintAlert() {
  const el = document.getElementById('tg-alert');
  if (!el) return;
  const t = alertText();
  el.hidden = !t;
  if (t) el.querySelector('span').textContent = t;
}

// The same warning on Home (phones don't show the sidebar).
export function alertBanner() {
  const t = alertText();
  return t ? `<div class="banner warn"><p>⚠️ ${esc(t)}</p><button class="btn primary" data-act="tg-fix">Fix it</button></div>` : '';
}

export function openFix() {
  ctx.ui.settingsTab = 'connect';
  if (location.hash === '#settings') ctx.render(); else location.hash = '#settings';
}

async function loadStatus({ quiet = false } = {}) {
  const was = !!st.status?.linked;
  const before = JSON.stringify({ ...st.status, lastCheck: 0 });
  st.status = await bot()?.status().catch(() => null);
  st.bg = await bg()?.get().catch(() => null);
  paintAlert();
  if (st.status?.server?.on) pushSnapshot();
  // A background check redraws the card only when something changed, and
  // never while you are typing in it.
  const typing = document.activeElement?.closest?.('#tg-card');
  if (!quiet || (before !== JSON.stringify({ ...st.status, lastCheck: 0 }) && !typing)) refresh();
  // The Log screen shows "From Telegram" once we know the bot is linked.
  if (was !== !!st.status?.linked && /^#log/.test(location.hash)) ctx.render();
}

const send = (text, extra) => bot()?.send(text, extra).catch((e) => console.warn('Telegram send failed', e));
const keyboard = () => ({ reply_markup: T.quickKeyboard(ctx.state) });
// Sent more than 2 minutes before the app saw it: the PC was off or asleep.
const isLate = (u) => u.message?.date && Date.now() / 1000 - u.message.date > 120;
const localDay = (unix) => todayISO(new Date(unix * 1000));

function undo(id) {
  const t = id ? ctx.state.tx.find((x) => x.id === id) : M.sortTx(ctx.state.tx).filter((x) => x.source === 'telegram').sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!t) return null;
  M.removeTx(ctx.state, t.id);
  return t;
}

// Handles messages in order; confirms only what was handled.
async function handle(updates) {
  const { state } = ctx;
  if (ctx.DEMO || state._sealed) return; // locked: they wait (Telegram keeps them)
  const done = [];
  const logged = [];
  const caughtUp = [];
  let changed = false;
  let current = null; // the update being handled, for records made from it
  // Log a record from a message: reply with what it was (or one summary later).
  const logFields = (f, u = current, late = isLate(u)) => {
    const cur = M.account(state, f.account)?.currency || state.settings.currency;
    const rate = cur === state.settings.currency ? 1 : ctx.suggestedRate(cur) || 1;
    const t = T.recordFromMessage(f, { updateId: u.update_id, date: T.recordDay(localDay(u.message.date), f), rate, currency: cur });
    state.tx.push(t);
    changed = true;
    logged.push(t);
    ctx.ui.flashId = t.id;
    // Sent while the app was closed: one summary at the end instead.
    if (late) caughtUp.push(t);
    // Just a number ("70"): offer your categories to file it in one tap.
    else if (!t.note) send(`${T.loggedText(state, t, todayISO())}\n\nWhat was it? 👇`, { reply_markup: { inline_keyboard: categoryButtons(t) } });
    else send(T.loggedText(state, t, todayISO()), { reply_markup: { inline_keyboard: [[{ text: '↩️ Undo', callback_data: `undo:${t.id}` }]] } });
  };
  for (const u of updates) {
    current = u;
    try {
      if (u.callback_query) {
        const cq = u.callback_query;
        const [what, id] = String(cq.data || '').split(':');
        if (what === 'cat') {
          const [, txId, catId] = String(cq.data).split(':');
          const t = state.tx.find((x) => x.id === txId);
          const c = M.category(state, catId);
          if (t && c) {
            t.category = catId;
            M.touch(t);
            changed = true;
            bot().answer(cq.id, `Filed as ${c.name}`);
            bot().edit(cq.message.message_id, `✅ <b>${t.type === 'income' ? '+' : '−'}${esc((t.amount / 100).toString().replace('.', ','))} ${esc(t.currency)}</b>${t.note ? ` · ${esc(t.note)}` : ''} → ${esc(c.name)}`).catch(() => {});
          } else bot().answer(cq.id, 'Not found');
        }
                if (what === 'undo') {
          const t = undo(id);
          changed ||= !!t;
          bot().answer(cq.id, t ? 'Removed' : 'Already removed');
          if (t) bot().edit(cq.message.message_id, `↩️ <s>${esc(t.note || '')} ${esc((t.amount / 100).toString())}</s> removed`).catch(() => {});
        }
        done.push(u.update_id);
        continue;
      }
      const text = (u.message?.text || '').trim();
      const cmd = text.toLowerCase().replace(/@\w+$/, '');
      if (!text) { done.push(u.update_id); continue; }
      if (cashReply(text, u)) { changed = true; done.push(u.update_id); continue; }
      if (amountReply(text, u, (f) => logFields(f))) { done.push(u.update_id); continue; }
      const late = isLate(u);
      if (cmd.startsWith('/start') || cmd === '/help' || text === '❓ Help') { if (!late) send(`👋 Ready.\n\n${T.HELP}\n/review: your week · /cash: count your wallet`, keyboard()); }
      else if (cmd === '/review') { if (!late) sendWeekly(); }
      else if (cmd === '/cash') { if (!late) askCash(); }
      else if (cmd === '/safe' || text === '🟢 Safe') { if (!late) send(T.safeDetailsText(state, todayISO()), keyboard()); }
      else if (cmd === '/goals' || text === '🎯 Goals') { if (!late) send(T.goalsText(state, todayISO()), keyboard()); }
      else if (cmd === '/rates' || text === '💵 Rates') { if (!late) send(T.ratesText(state), keyboard()); }
      else if (cmd === '/today' || text === '📊 Today') { if (!late) send(T.todayText(state, todayISO()), keyboard()); }
      else if (cmd === '/month' || text === '📅 Month') { if (!late) send(T.monthText(state, todayISO()), keyboard()); }
      else if (cmd === '/balance' || text === '💰 Balance') { if (!late) send(T.balanceText(state)); }
      else if (cmd === '/last' || text === '🧾 Last') { if (!late) send(T.lastText(state)); }
      else if (cmd === '/blocks') send(`🧱 <b>Your buttons</b>\n${Blocks.blocks(state).map((b) => esc(Blocks.blockLabel(b))).join('\n')}\n\nAdd: <code>/addblock 🍕 Pizza 120</code> · remove: <code>/delblock pizza</code>. Or edit them in the app: Settings → Telegram & Binance.`, keyboard());
      else if (/^\/(addblock|block)\b/.test(cmd)) {
        const b = Blocks.blockFromText(state, text);
        if (b) { Blocks.upsertBlock(state, b); changed = true; send(`🧱 Added <b>${esc(Blocks.blockLabel(b))}</b>`, keyboard()); }
        else send('Write it like <code>/addblock 🍕 Pizza 120</code>.');
      } else if (/^\/delblock\b/.test(cmd)) {
        const b = Blocks.matchBlock(state, text.replace(/^\/delblock(@\w+)?/i, ''));
        if (b) { Blocks.removeBlock(state, b.id); changed = true; send(`🧱 Removed ${esc(Blocks.blockLabel(b))}`, keyboard()); }
        else send('No button with that name. /blocks shows them.');
      } else if (cmd === '/undo' || text === '↩️ Undo') {
        // Works while the PC was off too: it fixes the tap just before it.
        // In a batch, "last" is the record logged just before in this batch.
        const t = logged.length ? undo(logged.pop().id) : undo();
        changed ||= !!t;
        if (t && caughtUp.at(-1) === t) caughtUp.pop();
        if (!late) send(t ? `↩️ Removed ${esc(t.note || '')} ${esc((t.amount / 100).toString())}` : 'Nothing from Telegram to undo.');
      } else {
        const id = `tg-${u.update_id}`;
        if (state.tx.some((t) => t.id === id) || state.deleted[id]) { done.push(u.update_id); continue; } // seen before
        const block = Blocks.matchBlock(state, text);
        let f = block && block.amount > 0 ? Blocks.blockFields(state, block) : null;
        if (block && !(block.amount > 0)) {
          // A block with no fixed amount: ask how much.
          state.meta.tgAwait = { kind: 'amount', block: block.id, until: Date.now() + 30 * 60000 };
          ctx.persist();
          if (!late) send(`How much for <b>${esc(`${block.emoji ? `${block.emoji} ` : ''}${block.name}`)}</b>? Send the number, e.g. <code>45</code>.`, { reply_markup: { force_reply: true, input_field_placeholder: 'e.g. 45' } });
          done.push(u.update_id);
          continue;
        }
        if (!f) {
          f = T.parseQuick(text, state);
          // "coffee 45": your Coffee block's category and account, with this amount.
          const named = f?.note && Blocks.matchBlock(state, f.note);
          if (named) f = { ...Blocks.blockFields(state, named), amount: f.amount, ...(f.daysAgo ? { daysAgo: f.daysAgo } : {}) };
        }
        if (!f) send('I didn\'t catch an amount. Tap a block, or try <code>coffee 35</code>, <code>70</code> or <code>+500 salary</code>.');
        else logFields(f, u, late);
      }
      done.push(u.update_id);
    } catch (e) {
      console.warn('Telegram message failed', e);
      done.push(u.update_id); // don't get stuck on one bad message
    }
  }
  if (caughtUp.length) send(T.catchUpText(state, caughtUp, todayISO()), keyboard());
  if (changed) {
    ctx.commit();
    ctx.toast(logged.length ? `${logged.length} record${logged.length === 1 ? '' : 's'} from Telegram` : 'Updated from Telegram');
  }
  lastLoaded = logged.length;
  if (done.length) bot().ack(done);
  pushSnapshot();
}

let lastLoaded = 0;
export const isLinked = () => !!st.status?.linked;

// "Load from Telegram": ask the bot right now and say what came in.
export async function loadNow() {
  if (!bot()) return;
  if (!st.status?.linked) { ctx.toast('Link your Telegram bot first: Settings → Telegram & Binance'); return; }
  ctx.toast('Checking Telegram…');
  lastLoaded = 0;
  const n = await bot().loadNow().catch(() => -1);
  if (n < 0) { ctx.toast(st.error || 'Telegram did not answer. Check the internet connection.'); return; }
  // The messages are handled by now (or a moment later).
  setTimeout(() => { if (!lastLoaded) ctx.toast('Telegram: nothing new. You\'re up to date.'); }, 1200);
}

// After editing blocks: show the new buttons in Telegram (once, after a pause).
let kbTimer = null;
export function pushKeyboard() {
  if (!st.status?.linked) return;
  clearTimeout(kbTimer);
  kbTimer = setTimeout(() => send('🧱 Your buttons are updated.', keyboard()), 4000);
}

// Once a minute: the evening reminder and the morning bills note.
function tick() {
  const { state } = ctx;
  if (ctx.DEMO || state._sealed || !st.status?.linked) return;
  pushSnapshot(); // the day changed, or records were edited in the app
  const p = prefs();
  const today = todayISO();
  const hm = new Date().toTimeString().slice(0, 5);
  const m = state.meta;
  if (p.daily && hm >= p.at && m.tgLastDaily !== today) {
    m.tgLastDaily = today;
    ctx.persist();
    send(T.reminderText(state, today), keyboard());
  }
  if (p.weekly && weekday(today) === Number(p.weeklyDay) && hm >= p.weeklyAt && m.tgLastWeekly !== today) {
    m.tgLastWeekly = today;
    ctx.persist();
    sendWeekly();
  }
  if (p.bills && hm >= '09:00' && m.tgLastBills !== today) {
    m.tgLastBills = today;
    ctx.persist();
    const text = T.billsText(state, today);
    if (text) send(text);
  }
}

export function initTelegram() {
  if (!bot() || ctx.DEMO) return;
  bot().onUpdates(handle);
  bot().onEvent((ev) => {
    if (ev.type === 'linked') {
      ctx.toast(`Telegram linked${ev.name ? ` with ${ev.name}` : ''}`);
      st.pair = null;
      loadStatus().then(() => send(`👋 Hi${ev.name ? ` ${esc(ev.name)}` : ''}! Finance Helper is linked.\n\n${T.HELP}`, keyboard()));
    } else if (ev.type === 'error') loadStatus({ quiet: true }); // shows the warning right away
  });
  // A warning under "All my money" when the bot can't work.
  const top = document.getElementById('side-top');
  if (top && !document.getElementById('tg-alert')) {
    top.insertAdjacentHTML('afterend', '<button type="button" class="side-alert" id="tg-alert" hidden><b aria-hidden="true">⚠</b><span></span></button>');
    document.getElementById('tg-alert').addEventListener('click', openFix);
  }
  loadStatus();
  setInterval(() => loadStatus({ quiet: true }), 30000);
  setInterval(tick, 60000);
  setTimeout(tick, 8000);
}

// After unlocking encrypted data: handle what waited.
export const resume = () => loadStatus();

// ---------- Settings ----------

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// "Always on": a free Google script in the user's own account answers the
// bot and keeps the messages while this PC is off (electron/relay.gs).
function serverSection(sv) {
  const live = sv.okAt && Date.now() - sv.okAt < 60000;
  return `<div class="tg-relay on">
    <h3>🖥 Always on: your server <span class="right ${sv.error ? 'expense' : 'income'}">● ${sv.error ? 'not reachable' : live ? 'live' : 'connecting…'}</span></h3>
    <p class="muted small" style="margin-top:0">Your server reads the bot day and night. While this app is open, messages arrive here within a second; while the PC is off, the bot answers right away and keeps them for later. It also keeps a short summary of your numbers (today, balance, month) so /today and /balance work with the PC off.</p>
    ${sv.error ? `<p class="lock-msg">${esc(sv.error)}</p>` : ''}
    <div class="kv"><span>Server</span><b>${esc(sv.url.replace(/^https?:\/\//, ''))}</b></div>
    ${sv.okAt ? `<div class="kv"><span>Last contact</span><b>${esc(ago(sv.okAt))}</b></div>` : ''}
    ${sv.lastTick ? `<div class="kv"><span>Server read Telegram</span><b>${esc(ago(sv.lastTick))}</b></div>` : ''}
    ${sv.waiting ? `<div class="kv"><span>Waiting to be logged</span><b>${sv.waiting}</b></div>` : ''}
    ${sv.snapshotAt ? `<div class="kv"><span>Summary on the server</span><b>${esc(ago(sv.snapshotAt))}</b></div>` : ''}
    <div class="btns" style="margin-top:8px"><button class="btn" data-act="tg-server-off" ${st.relay.busy ? 'disabled' : ''}>Stop using the server</button></div>
  </div>`;
}

function serverForm() {
  const rs = st.relay;
  return `<div class="tg-relay">
    <h3>🖥 Always on with your own server</h3>
    <ol class="steps small">
      <li>On the server (next to Hermes): <code>git clone https://github.com/vicuvi1/Finance-Helper-App</code>, then in <code>Finance-Helper-App/server</code> run <code>docker compose up -d --build</code>.</li>
      <li><code>docker compose logs finance-bot</code> shows your <b>key</b>. Copy it.</li>
      <li>Paste the server's address: <code>https://your-domain</code>, or with Tailscale <code>http://server-name:8787</code>. Details in <code>server/README.md</code>.</li>
    </ol>
    <form id="tg-server-form" autocomplete="off">
      <label class="field"><span>Server address</span><input id="tg-server-url" type="text" inputmode="url" placeholder="https://money.example.com" spellcheck="false"></label>
      <label class="field"><span>Key</span><input id="tg-server-key" type="password" placeholder="from docker compose logs" spellcheck="false"></label>
      ${rs.error ? `<p class="lock-msg">${esc(rs.error)}</p>` : ''}
      <div class="btns"><button class="btn primary" type="submit" ${rs.busy ? 'disabled' : ''}>${rs.busy ? 'Connecting…' : 'Connect'}</button><button class="btn" type="button" data-act="tg-relay-cancel">Not now</button></div>
    </form>
  </div>`;
}

function relaySection(s) {
  const r = s.relay || { on: false };
  const rs = st.relay;
  if (s.server?.on) return serverSection(s.server);
  if (rs.open === 'server') return serverForm();
  if (r.on) {
    const problem = r.error ? `The app can't reach your Google script: ${r.error}`
      : r.okAt && !r.trigger ? 'Google isn\'t checking your bot yet. In the script editor pick <b>install</b> in the list next to ▶ Run, press ▶ Run and allow it.'
      : r.lastError && !/conflict|terminated by other/i.test(r.lastError) ? `Google's last check said: ${r.lastError}` : '';
    return `<div class="tg-relay on">
      <h3>🌙 Always on <span class="right ${problem ? 'expense' : 'income'}">● ${problem ? 'needs a look' : 'on'}</span></h3>
      <p class="muted small" style="margin-top:0">While this PC is off, your Google script answers the bot every minute and keeps what you send. It all lands here, on the right day, when the app opens.</p>
      ${problem ? `<p class="lock-msg">${problem.startsWith('Google isn') ? problem : esc(problem)}</p>` : ''}
      ${r.lastTick ? `<div class="kv"><span>Google last checked</span><b>${esc(ago(r.lastTick))}</b></div>` : r.trigger ? '<div class="kv"><span>Google</span><b>first check within a minute</b></div>' : ''}
      ${r.okAt ? `<div class="kv"><span>Collected from Google</span><b>${esc(ago(r.okAt))}</b></div>` : ''}
      ${r.waiting ? `<div class="kv"><span>Waiting to be logged</span><b>${r.waiting}</b></div>` : ''}
      <div class="btns" style="margin-top:8px"><button class="btn" data-act="tg-relay-off" ${rs.busy ? 'disabled' : ''}>Turn always-on off</button></div>
    </div>`;
  }
  if (!rs.open) {
    return `<div class="tg-relay">
      <h3>🌙 Make it always on</h3>
      <p class="muted small" style="margin-top:0">Right now the bot answers only while this app is open. Make it always on, so it answers even when the PC is off:</p>
      <div class="btns"><button class="btn primary" data-act="tg-server-start">🖥 My own server (instant, live)</button><button class="btn" data-act="tg-relay-start">Google script (free, every minute)</button></div>
    </div>`;
  }
  return `<div class="tg-relay">
    <h3>🌙 Always on: one-time setup</h3>
    <ol class="steps small">
      <li><button class="btn ${rs.copied ? '' : 'primary'}" data-act="tg-relay-copy">${rs.copied ? '✓ Copied' : '📋 Copy the script'}</button>
        ${rs.script ? `<textarea class="tg-script" readonly rows="4" aria-label="The script">${esc(rs.script)}</textarea><span>Copying didn't work: click in the box, Ctrl+A, Ctrl+C.</span>` : ''}</li>
      <li><button class="btn" data-act="tg-relay-site">Open Google Apps Script ↗</button> (sign in with your Google account). A new project opens.</li>
      <li>Click in the code, <b>Ctrl+A</b>, then <b>Ctrl+V</b> to paste over everything. Press 💾 <b>Save</b>.</li>
      <li>Top right: <b>Deploy → New deployment</b>. Next to "Select type" press ⚙ → <b>Web app</b>. Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>. Press <b>Deploy</b>.</li>
      <li>Google asks for access: <b>Authorize access</b> → your account → <b>Advanced</b> → <b>Go to … (unsafe)</b> → <b>Allow</b>. It warns only because the script is yours and not published.</li>
      <li>Copy the <b>Web app URL</b> it shows and paste it here:</li>
    </ol>
    <form id="tg-relay-form" autocomplete="off">
      <label class="field"><span>Web app URL</span><input id="tg-relay-url" type="text" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false"></label>
      ${rs.error ? `<p class="lock-msg">${esc(rs.error)}</p>` : ''}
      <div class="btns"><button class="btn primary" type="submit" ${rs.busy ? 'disabled' : ''}>${rs.busy ? 'Checking…' : 'Turn on'}</button><button class="btn" type="button" data-act="tg-relay-cancel">Not now</button></div>
    </form>
  </div>`;
}

const steps = `<ol class="steps small">
  <li>In Telegram, open <b>@BotFather</b> and send <code>/newbot</code>. Pick any name, e.g. "My money".</li>
  <li>BotFather replies with a <b>token</b> (looks like <code>123456789:AA…</code>). Paste it below.</li>
</ol>`;

export function settingsCard() {
  if (ctx.DEMO || !bot()) {
    return `<section class="card" id="tg-card"><h2>Telegram bot</h2><p class="muted small" style="margin:0">Log from Telegram (<code>coffee 35</code>, one-tap buttons) and get reminders there. Works with the desktop app: it talks to your own bot, no server in between.</p></section>`;
  }
  const s = st.status;
  const p = prefs();
  const b = st.bg || { background: true, atLogin: false };
  if (!s?.connected) {
    return `<section class="card" id="tg-card"><h2>Telegram bot</h2>
      <p class="muted small" style="margin-top:0">Log spending from Telegram in a second (<code>coffee 35</code> or a tap on a button), and get a reminder in the evening. Your own private bot, about 2 minutes to set up:</p>
      ${steps}
      <form id="tg-form" autocomplete="off"><label class="field"><span>Bot token</span><input id="tg-token" type="password" placeholder="123456789:AA…" spellcheck="false"></label>
      ${st.error ? `<p class="lock-msg">${esc(st.error)}</p>` : ''}
      <button class="btn primary block" type="submit" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Checking…' : 'Connect bot'}</button></form></section>`;
  }
  if (!s.linked) {
    return `<section class="card" id="tg-card"><h2>Telegram bot <span class="right muted">@${esc(s.botName)}</span></h2>
      <p style="margin-top:0">Last step: link your Telegram account, so the bot listens only to you.</p>
      ${st.error ? `<p class="lock-msg">${esc(st.error)}</p>` : ''}
      ${st.pair ? `<p class="tg-code">${esc(st.pair.code)}</p><p class="muted small">Tap below to open the bot and press <b>Start</b>, or send it this code.</p>
        <div class="btns"><button class="btn primary" data-act="tg-open">Open @${esc(s.botName)} in Telegram</button><button class="btn" data-act="tg-pair">New code</button></div>`
        : '<button class="btn primary block" data-act="tg-pair">Show my link code</button>'}
      <div class="btns" style="margin-top:8px"><button class="btn danger" data-act="tg-off">Disconnect</button></div></section>`;
  }
  const fixToken = s.errorCode === 'token' ? `<form id="tg-form" autocomplete="off" class="tg-fix">
      <p class="lock-msg" style="margin-top:0">${esc(s.error)}</p>
      <p class="muted small" style="margin:0 0 8px">In Telegram: <b>@BotFather</b> → /mybots → your bot → API Token. Paste it here; your chat stays linked.</p>
      <label class="field"><span>New bot token</span><input id="tg-token" type="password" placeholder="123456789:AA…" spellcheck="false"></label>
      ${st.error ? `<p class="lock-msg">${esc(st.error)}</p>` : ''}
      <button class="btn primary block" type="submit" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Checking…' : 'Reconnect the bot'}</button></form>` : '';
  return `<section class="card" id="tg-card"><h2>Telegram bot <span class="right ${s.errorCode ? 'expense' : 'income'}">● ${s.errorCode ? 'not working' : 'linked'}</span></h2>
    ${fixToken}
    <div class="kv"><span>Bot</span><b>@${esc(s.botName)}</b></div>
    ${s.userName ? `<div class="kv"><span>Listens to</span><b>${esc(s.userName)}</b></div>` : ''}
    ${!fixToken && (s.error || st.error) ? `<p class="lock-msg">${esc(s.error || st.error)}</p>` : ''}
    ${s.lastCheck ? `<div class="kv"><span>Last checked</span><b>${esc(new Date(s.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</b></div>` : ''}
    <p class="muted small">Send <code>coffee 35</code>, <code>taxi 45 cash</code>, <code>coffee 35 yesterday</code>, <code>+500 salary</code>, or tap a button below the chat. /today, /month, /balance, /last, /undo.</p>
    ${s.relay?.on || s.server?.on ? '' : '<p class="muted small"><b>PC off?</b> Keep logging on your phone: Telegram keeps the messages for 24 hours and the app logs them, on the day you sent them, as soon as it opens. You get one summary message.</p>'}
    <button class="btn primary block" data-act="tg-load">📥 Load from Telegram now</button>
    ${relaySection(s)}
    <label class="field check"><input type="checkbox" data-tg="daily" ${p.daily ? 'checked' : ''}><span>Evening reminder to log</span></label>
    ${p.daily ? `<label class="field"><span>Remind me at</span><input type="time" data-tg="at" value="${esc(p.at)}"></label>` : ''}
    <label class="field check"><input type="checkbox" data-tg="bills" ${p.bills ? 'checked' : ''}><span>Morning note when a bill is due today or tomorrow</span></label>
    <label class="field check"><input type="checkbox" data-tg="weekly" ${p.weekly ? 'checked' : ''}><span>Weekly money ritual: your week's score, biggest leak, records to file</span></label>
    ${p.weekly ? `<div class="row2"><label class="field"><span>On</span><select data-tg="weeklyDay">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${Number(p.weeklyDay) === d ? 'selected' : ''}>${DOW_LONG[(d + 6) % 7]}</option>`).join('')}</select></label>
      <label class="field"><span>At</span><input type="time" data-tg="weeklyAt" value="${esc(p.weeklyAt)}"></label></div>
      <label class="field check"><input type="checkbox" data-tg="cash" ${p.cash ? 'checked' : ''}><span>…and a cash check: the bot asks how much is in your wallet</span></label>` : ''}
    <label class="field check"><input type="checkbox" data-bg="background" ${b.background ? 'checked' : ''}><span>Keep running in the tray when I close the window (so reminders and the bot keep working)</span></label>
    <label class="field check"><input type="checkbox" data-bg="atLogin" ${b.atLogin ? 'checked' : ''}><span>Start with the computer (in the tray)</span></label>
    <div class="btns" style="margin-top:10px"><button class="btn" data-act="tg-test">Send a test</button><button class="btn" data-act="tg-review">Send my week now</button><button class="btn danger" data-act="tg-off">Disconnect</button></div>
  </section>`;
}

const cleanError = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function relayConnect(form) {
  const rs = st.relay;
  rs.busy = true;
  rs.error = '';
  const url = form.querySelector('#tg-relay-url').value;
  refresh();
  try {
    const r = await bot().relayConnect(url);
    Object.assign(st.relay, { open: false, copied: false, script: '' });
    ctx.toast(r.trigger ? 'Always on ✓ Your bot now works even when the PC is off.' : 'Connected. One more step: Google isn\'t checking yet (see Settings → Telegram).');
  } catch (e) {
    rs.error = cleanError(e);
  }
  rs.busy = false;
  await loadStatus();
  if (rs.error) { const i = document.getElementById('tg-relay-url'); if (i) i.value = url; }
}

async function serverConnect(form) {
  const rs = st.relay;
  rs.busy = true;
  rs.error = '';
  const url = form.querySelector('#tg-server-url').value;
  const key = form.querySelector('#tg-server-key').value;
  refresh();
  try {
    await bot().serverConnect(url, key);
    rs.open = false;
    ctx.toast('Connected ✓ Your bot now lives on your server, always on.');
    lastSnap = '';
    pushSnapshot();
  } catch (e) {
    rs.error = cleanError(e);
  }
  rs.busy = false;
  await loadStatus();
  if (rs.error) { const i = document.getElementById('tg-server-url'); if (i) i.value = url; }
}

// A short summary of your numbers for your server, so the bot can answer
// /today, /balance, /month and /last while the PC is off.
let lastSnap = '';
let snapTimer = null;
export function pushSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const { state } = ctx;
    if (ctx.DEMO || state._sealed || !st.status?.server?.on) return;
    const today = todayISO();
    const snap = {
      today: T.todayText(state, today), balance: T.balanceText(state), month: T.monthText(state, today), last: T.lastText(state),
      safe: T.safeDetailsText(state, today),
      goals: T.goalsText(state, today),
      rates: T.ratesText(state),
    };
    const key = JSON.stringify(snap);
    if (key === lastSnap) return;
    bot()?.snapshot?.(snap).then(() => { lastSnap = key; }, () => {});
  }, 3000);
}

export async function onSubmit(form) {
  if (form.id === 'tg-server-form') { await serverConnect(form); return true; }
  if (form.id === 'tg-relay-form') { await relayConnect(form); return true; }
  if (form.id !== 'tg-form') return false;
  st.busy = true;
  st.error = '';
  refresh();
  try {
    const r = await bot().connect(form.querySelector('#tg-token').value);
    form.querySelector('#tg-token').value = '';
    if (r?.kept) { st.pair = null; ctx.toast('Bot reconnected. Your Telegram is still linked ✓'); } else st.pair = await bot().pair();
  } catch (e) {
    st.error = cleanError(e);
  }
  st.busy = false;
  await loadStatus();
  return true;
}

export function onClick(act) {
  if (act === 'tg-fix') { openFix(); return true; }
  if (act === 'tg-load') { loadNow().then(loadStatus); return true; }
  if (act === 'tg-pair') { bot().pair().then((p) => { st.pair = p; refresh(); }); return true; }
  if (act === 'tg-open') { if (st.pair?.link) bot().openLink(st.pair.link); return true; }
  if (act === 'tg-review') { sendWeekly().then(() => ctx.toast('Sent. Check Telegram.')); return true; }
  if (act === 'tg-test') { send(T.reminderText(ctx.state, todayISO()), keyboard()).then(() => ctx.toast('Sent. Check Telegram.')); return true; }
  if (act === 'tg-relay-start') { st.relay.open = 'google'; refresh(); return true; }
  if (act === 'tg-server-start') { st.relay.open = 'server'; st.relay.error = ''; refresh(); return true; }
  if (act === 'tg-server-off') {
    st.relay.busy = true;
    refresh();
    bot().serverOff().finally(() => { st.relay.busy = false; loadStatus(); ctx.toast('The app reads Telegram itself again. You can stop the server container.'); });
    return true;
  }
  if (act === 'tg-relay-cancel') { Object.assign(st.relay, { open: false, error: '', script: '' }); refresh(); return true; }
  if (act === 'tg-relay-site') { bot().openLink('https://script.google.com/home/projects/create'); return true; }
  if (act === 'tg-relay-copy') {
    bot().relayScript().then(async (text) => {
      try { await navigator.clipboard.writeText(text); st.relay.copied = true; st.relay.script = ''; ctx.toast('Script copied. Now open Google Apps Script.'); } catch { st.relay.script = text; }
      refresh();
    }, (e) => ctx.toast(cleanError(e)));
    return true;
  }
  if (act === 'tg-relay-off') {
    st.relay.busy = true;
    refresh();
    bot().relayOff().finally(() => { st.relay.busy = false; loadStatus(); ctx.toast('Always on is off. You can delete the script at script.google.com.'); });
    return true;
  }
  if (act === 'tg-off') { bot().disconnect().then(() => { st.pair = null; st.error = ''; loadStatus(); ctx.toast('Telegram disconnected'); }); return true; }
  return false;
}

export function onChange(el) {
  if (el.dataset.tg) {
    const p = prefs();
    p[el.dataset.tg] = el.type === 'checkbox' ? el.checked : el.value;
    ctx.state.meta.tg = p;
    ctx.persist();
    refresh();
    return true;
  }
  if (el.dataset.bg) {
    bg()?.set({ [el.dataset.bg]: el.checked }).then((b) => { st.bg = b; refresh(); });
    return true;
  }
  return false;
}
