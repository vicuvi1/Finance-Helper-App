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

const bot = () => window.desktop?.telegram;
const bg = () => window.desktop?.background;
const st = { status: null, pair: null, busy: false, error: '', bg: null };
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

async function loadStatus() {
  const was = !!st.status?.linked;
  st.status = await bot()?.status().catch(() => null);
  st.bg = await bg()?.get().catch(() => null);
  refresh();
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
  for (const u of updates) {
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
            bot().edit(cq.message.message_id, `✅ <b>${esc(t.note)}</b> → ${esc(c.name)}`).catch(() => {});
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
      const late = isLate(u);
      if (cmd.startsWith('/start') || cmd === '/help' || text === '❓ Help') { if (!late) send(`👋 Ready.\n\n${T.HELP}\n/review: your week · /cash: count your wallet`, keyboard()); }
      else if (cmd === '/review') { if (!late) sendWeekly(); }
      else if (cmd === '/cash') { if (!late) askCash(); }
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
        const f = block ? Blocks.blockFields(state, block) : T.parseQuick(text, state);
        if (!f) send('I didn\'t catch an amount. Tap a block, or try <code>coffee 35</code> or <code>+500 salary</code>.');
        else {
          const cur = M.account(state, f.account)?.currency || state.settings.currency;
          const rate = cur === state.settings.currency ? 1 : ctx.suggestedRate(cur) || 1;
          const t = T.recordFromMessage(f, { updateId: u.update_id, date: T.recordDay(localDay(u.message.date), f), rate, currency: cur });
          state.tx.push(t);
          changed = true;
          logged.push(t);
          ctx.ui.flashId = t.id;
          // Sent while the app was closed: one summary at the end instead.
          if (late) caughtUp.push(t);
          else send(T.loggedText(state, t), { reply_markup: { inline_keyboard: [[{ text: '↩️ Undo', callback_data: `undo:${t.id}` }]] } });
        }
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
    } else if (ev.type === 'error') { st.error = ev.message; refresh(); }
  });
  loadStatus();
  setInterval(tick, 60000);
  setTimeout(tick, 8000);
}

// After unlocking encrypted data: handle what waited.
export const resume = () => loadStatus();

// ---------- Settings ----------

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
  return `<section class="card" id="tg-card"><h2>Telegram bot <span class="right income">● linked</span></h2>
    <div class="kv"><span>Bot</span><b>@${esc(s.botName)}</b></div>
    ${s.userName ? `<div class="kv"><span>Listens to</span><b>${esc(s.userName)}</b></div>` : ''}
    ${s.error || st.error ? `<p class="lock-msg">${esc(s.error || st.error)}</p>` : ''}
    ${s.lastCheck ? `<div class="kv"><span>Last checked</span><b>${esc(new Date(s.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</b></div>` : ''}
    <p class="muted small">Send <code>coffee 35</code>, <code>taxi 45 cash</code>, <code>coffee 35 yesterday</code>, <code>+500 salary</code>, or tap a button below the chat. /today, /month, /balance, /last, /undo.</p>
    <p class="muted small"><b>PC off?</b> Keep logging on your phone: Telegram keeps the messages for 24 hours and the app logs them, on the day you sent them, as soon as it opens. You get one summary message.</p>
    <button class="btn primary block" data-act="tg-load">📥 Load from Telegram now</button>
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

export async function onSubmit(form) {
  if (form.id !== 'tg-form') return false;
  st.busy = true;
  st.error = '';
  refresh();
  try {
    await bot().connect(form.querySelector('#tg-token').value);
    form.querySelector('#tg-token').value = '';
    st.pair = await bot().pair();
  } catch (e) {
    st.error = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  st.busy = false;
  await loadStatus();
  return true;
}

export function onClick(act) {
  if (act === 'tg-load') { loadNow().then(loadStatus); return true; }
  if (act === 'tg-pair') { bot().pair().then((p) => { st.pair = p; refresh(); }); return true; }
  if (act === 'tg-open') { if (st.pair?.link) bot().openLink(st.pair.link); return true; }
  if (act === 'tg-review') { sendWeekly().then(() => ctx.toast('Sent. Check Telegram.')); return true; }
  if (act === 'tg-test') { send(T.reminderText(ctx.state, todayISO()), keyboard()).then(() => ctx.toast('Sent. Check Telegram.')); return true; }
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
