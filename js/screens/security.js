// Security: the lock screen, auto-lock after inactivity, and the Settings
// card to set, change or remove the PIN. The PIN hash lives in state.meta
// (this device only).

import { ctx } from '../ctx.js';
import { createLock, checkPin, validPin, waitAfter } from '../lock.js';

const AUTO = [1, 5, 15, 60, 0]; // minutes; 0 = only when the app starts
let locked = false;
let lastActive = Date.now();
let hiddenAt = null;

const meta = () => ctx.state.meta;
export const hasLock = () => !!meta().lock?.hash;
export const isLocked = () => locked;

export function lock() {
  if (!hasLock() || locked) return;
  locked = true;
  ctx.closeSheet();
  document.body.classList.add('locked');
  const root = document.getElementById('lock-root');
  root.hidden = false;
  root.innerHTML = `<form class="lock-card" id="lock-form" autocomplete="off">
      <img src="icons/icon.svg" alt="" width="56" height="56">
      <h2>Finance Helper is locked</h2>
      <p class="muted">Enter your PIN to continue.</p>
      <input id="lock-pin" type="password" inputmode="${/^\d+$/.test(meta().lockHint || '') ? 'numeric' : 'text'}" autocomplete="current-password" aria-label="PIN" placeholder="PIN">
      <p class="lock-msg" id="lock-msg" role="alert"></p>
      <button class="btn primary block" type="submit">Unlock</button>
      <button class="card-link" type="button" id="lock-forgot">Forgot the PIN?</button>
    </form>`;
  const input = root.querySelector('#lock-pin');
  setTimeout(() => input.focus(), 50);
  root.querySelector('#lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = root.querySelector('#lock-msg');
    const until = meta().lockUntil || 0;
    if (Date.now() < until) { msg.textContent = `Too many tries. Wait ${Math.ceil((until - Date.now()) / 1000)} s.`; return; }
    if (await checkPin(meta().lock, input.value)) {
      meta().lockFails = 0;
      meta().lockUntil = 0;
      ctx.persist();
      unlock();
      return;
    }
    meta().lockFails = (meta().lockFails || 0) + 1;
    const wait = waitAfter(meta().lockFails);
    meta().lockUntil = wait ? Date.now() + wait : 0;
    ctx.persist();
    input.value = '';
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
    msg.textContent = wait ? `Wrong PIN. Wait ${wait / 1000} s before the next try.` : 'Wrong PIN.';
  });
  root.querySelector('#lock-forgot').addEventListener('click', () => {
    const f = root.querySelector('#lock-form');
    f.querySelector('#lock-forgot').remove();
    f.insertAdjacentHTML('beforeend', `<div class="lock-reset">
      <p>The PIN can't be recovered. You can reset this device: everything stored <b>on this device</b> is erased, then restore a backup file or sync from Google Drive.</p>
      <input id="lock-erase" type="text" placeholder="Type ERASE to confirm" aria-label="Type ERASE to confirm">
      <button class="btn danger block" type="button" id="lock-reset">Reset this device</button></div>`);
    f.querySelector('#lock-reset').addEventListener('click', () => {
      if (f.querySelector('#lock-erase').value.trim() !== 'ERASE') { root.querySelector('#lock-msg').textContent = 'Type ERASE in capitals to confirm.'; return; }
      ctx.resetDevice();
    });
  });
}

function unlock() {
  locked = false;
  lastActive = Date.now();
  document.body.classList.remove('locked');
  const root = document.getElementById('lock-root');
  root.hidden = true;
  root.innerHTML = '';
  ctx.render({ enter: true });
}

// Lock when idle or when the app comes back after being hidden long enough.
export function initLock() {
  const mark = () => { lastActive = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, mark, { passive: true });
  const minutes = () => meta().lockAfter ?? 5;
  setInterval(() => {
    if (hasLock() && !locked && minutes() > 0 && Date.now() - lastActive > minutes() * 60000) lock();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hasLock() && hiddenAt && minutes() > 0 && Date.now() - hiddenAt > minutes() * 60000) lock();
    hiddenAt = null;
  });
  if (hasLock()) lock();
}

// ---------- Settings ----------

export function settingsCard() {
  const on = hasLock();
  const after = meta().lockAfter ?? 5;
  return `<section class="card"><h2>Security</h2>
    <p class="muted small" style="margin-top:0">${on ? 'A PIN is asked when the app starts and after you\'ve been away.' : 'Ask for a PIN when the app opens, so nobody else can see your money.'} The PIN is kept on this device only.</p>
    ${on ? `<label class="field"><span>Lock after</span><select id="lock-after">${AUTO.map((m) => `<option value="${m}" ${m === after ? 'selected' : ''}>${m ? `${m} minute${m === 1 ? '' : 's'} away` : 'Only when the app starts'}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn" data-act="lock-now">Lock now</button><button class="btn" data-act="pin-change">Change PIN</button><button class="btn danger" data-act="pin-remove">Remove PIN</button></div>`
    : '<button class="btn primary block" data-act="pin-set">Set a PIN</button>'}
  </section>`;
}

function pinSheet(mode) {
  const needOld = mode !== 'set';
  ctx.openSheet(`<h3>${mode === 'remove' ? 'Remove PIN' : mode === 'change' ? 'Change PIN' : 'Set a PIN'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="pin-form" autocomplete="off">
      ${needOld ? '<label class="field"><span>Current PIN</span><input id="pin-old" type="password" autocomplete="current-password"></label>' : ''}
      ${mode !== 'remove' ? `<label class="field"><span>New PIN (4 or more digits or characters)</span><input id="pin-new" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Repeat the new PIN</span><input id="pin-new2" type="password" autocomplete="new-password"></label>` : ''}
      <p class="lock-msg" id="pin-msg" role="alert"></p>
      <div class="btns"><button class="btn primary" type="submit">${mode === 'remove' ? 'Remove PIN' : 'Save PIN'}</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('input')?.focus();
    sheet.querySelector('#pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = sheet.querySelector('#pin-msg');
      if (needOld && !(await checkPin(meta().lock, sheet.querySelector('#pin-old').value))) { msg.textContent = 'The current PIN is wrong.'; return; }
      if (mode === 'remove') {
        delete meta().lock;
        ctx.commit();
        ctx.closeSheet();
        ctx.toast('PIN removed');
        return;
      }
      const a = sheet.querySelector('#pin-new').value;
      const err = validPin(a);
      if (err) { msg.textContent = err; return; }
      if (a !== sheet.querySelector('#pin-new2').value) { msg.textContent = 'The two PINs are different.'; return; }
      meta().lock = await createLock(a);
      meta().lockHint = /^\d+$/.test(a) ? '0' : 'a'; // numeric keypad or not; never the PIN
      if (meta().lockAfter == null) meta().lockAfter = 5;
      ctx.commit();
      ctx.closeSheet();
      ctx.toast('PIN saved. Press L or "Lock now" to lock.');
    });
  });
}

export function onClick(act) {
  if (act === 'pin-set') { pinSheet('set'); return true; }
  if (act === 'pin-change') { pinSheet('change'); return true; }
  if (act === 'pin-remove') { pinSheet('remove'); return true; }
  if (act === 'lock-now') { lock(); return true; }
  return false;
}

export function onChange(el) {
  if (el.id !== 'lock-after') return false;
  meta().lockAfter = Number(el.value);
  ctx.persist();
  return true;
}

