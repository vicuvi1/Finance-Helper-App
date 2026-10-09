// Security: the lock screen, auto-lock after inactivity, and the Settings
// card to set, change or remove the PIN and to encrypt the data with it.
// The PIN hash lives in state.meta (this device only). With encryption on,
// locking also forgets the key and the data in memory (js/store.js).

import { ctx } from '../ctx.js';
import { createLock, checkPin, validPin, waitAfter } from '../lock.js';
import { isEncrypted, unlockStore, lockStore, enableEncryption, disableEncryption, load } from '../store.js';

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
  // Encrypted: drop the readable data from memory and the screen.
  if (isEncrypted() && !ctx.state._sealed) {
    document.getElementById('app').innerHTML = '';
    lockStore().then(() => { if (locked) ctx.setState(load()); });
  }
  root.querySelector('#lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = root.querySelector('#lock-msg');
    const until = meta().lockUntil || 0;
    if (Date.now() < until) { msg.textContent = `Too many tries. Wait ${Math.ceil((until - Date.now()) / 1000)} s.`; return; }
    const btn = root.querySelector('button[type=submit]');
    btn.disabled = true;
    const ok = await checkPin(meta().lock, input.value);
    const wasSealed = !!ctx.state._sealed;
    if (ok && wasSealed) {
      msg.textContent = 'Opening your data…';
      try {
        ctx.setState(await unlockStore(input.value));
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
        return;
      }
    }
    btn.disabled = false;
    if (ok) {
      meta().lockFails = 0;
      meta().lockUntil = 0;
      ctx.persist();
      unlock(wasSealed);
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
      <p>The PIN can't be recovered.${isEncrypted() ? ' Your data is encrypted with it, so it can\'t be opened without it.' : ''} You can reset this device: everything stored <b>on this device</b> is erased, then restore a backup file or sync from Google Drive${isEncrypted() ? ' (encrypted copies need the same PIN)' : ''}.</p>
      <input id="lock-erase" type="text" placeholder="Type ERASE to confirm" aria-label="Type ERASE to confirm">
      <button class="btn danger block" type="button" id="lock-reset">Reset this device</button></div>`);
    f.querySelector('#lock-reset').addEventListener('click', () => {
      if (f.querySelector('#lock-erase').value.trim() !== 'ERASE') { root.querySelector('#lock-msg').textContent = 'Type ERASE in capitals to confirm.'; return; }
      ctx.resetDevice();
    });
  });
}

function unlock(wasSealed) {
  if (ctx.state._sealed) return;
  locked = false;
  lastActive = Date.now();
  document.body.classList.remove('locked');
  const root = document.getElementById('lock-root');
  root.hidden = true;
  root.innerHTML = '';
  ctx.render({ enter: true });
  if (wasSealed) ctx.afterUnlock?.();
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
    <div class="kv"><span>Encrypt my data</span><b class="${isEncrypted() ? 'income' : ''}">${isEncrypted() ? 'On' : 'Off'}</b></div>
    <p class="muted small">${isEncrypted() ? 'Your data on this device, in Google Drive and in backups is encrypted with your PIN. Without the PIN it can\'t be read, not even by you.' : 'Scramble your data with the PIN so nobody can read it from this device\'s files, Google Drive or a backup.'}</p>
    <div class="btns"><button class="btn" data-act="lock-now">Lock now</button><button class="btn" data-act="pin-change">Change PIN</button>${isEncrypted() ? '<button class="btn" data-act="enc-off">Stop encrypting</button>' : ctx.DEMO ? '' : '<button class="btn primary" data-act="enc-on">Encrypt my data</button>'}<button class="btn danger" data-act="pin-remove">Remove PIN</button></div>`
    : '<button class="btn primary block" data-act="pin-set">Set a PIN</button><p class="muted small">After setting a PIN you can also encrypt your data with it.</p>'}
  </section>`;
}

function pinSheet(mode) {
  const needOld = mode !== 'set';
  ctx.openSheet(`<h3>${mode === 'remove' ? 'Remove PIN' : mode === 'change' ? 'Change PIN' : 'Set a PIN'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="pin-form" autocomplete="off">
      ${needOld ? '<label class="field"><span>Current PIN</span><input id="pin-old" type="password" autocomplete="current-password"></label>' : ''}
      ${mode === 'remove' && isEncrypted() ? '<p class="muted small" style="margin-top:0">Your data will be stored without encryption again.</p>' : ''}
      ${mode === 'change' && isEncrypted() ? '<p class="muted small" style="margin-top:0">Your data is re-encrypted with the new PIN. Change it on your other devices too, so they keep syncing.</p>' : ''}
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
        if (isEncrypted()) await disableEncryption(ctx.state);
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
      if (isEncrypted()) await enableEncryption(ctx.state, a); // re-seal with the new PIN
      ctx.commit();
      ctx.closeSheet();
      ctx.toast('PIN saved. Press L or "Lock now" to lock.');
    });
  });
}

function encryptSheet(on) {
  ctx.openSheet(`<h3>${on ? 'Encrypt my data' : 'Stop encrypting'} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <form id="enc-form" autocomplete="off">
      ${on ? `<p style="margin-top:0">Your records, accounts and notes are scrambled with your PIN (AES-256): on this device, in the Google Drive copy and in backups. Locking the app also clears them from memory.</p>
      <ul class="small muted" style="padding-left:18px">
        <li><b>If you forget the PIN, the data can't be recovered.</b> Nobody can open it, not even with the files. Write the PIN down somewhere safe.</li>
        <li>Use the <b>same PIN on all your devices</b>, so they can read each other's sync copy.</li>
        <li>Make a normal backup first (Settings → Your data → Back up) if you want one copy that opens without the PIN.</li>
      </ul>` : '<p style="margin-top:0">Your data will be stored readable again on this device, in Google Drive and in new backups. The PIN still locks the app.</p>'}
      <label class="field"><span>Your PIN</span><input id="enc-pin" type="password" autocomplete="current-password"></label>
      ${on ? '<label class="field check"><input type="checkbox" id="enc-ok"><span>I understand that a forgotten PIN means my data is lost</span></label>' : ''}
      <p class="lock-msg" id="enc-msg" role="alert"></p>
      <div class="btns"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${on ? 'Encrypt' : 'Stop encrypting'}</button></div>
    </form>`, (sheet) => {
    sheet.querySelector('#enc-pin').focus();
    sheet.querySelector('#enc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = sheet.querySelector('#enc-msg');
      const pin = sheet.querySelector('#enc-pin').value;
      if (!(await checkPin(meta().lock, pin))) { msg.textContent = 'The PIN is wrong.'; return; }
      if (on && !sheet.querySelector('#enc-ok').checked) { msg.textContent = 'Tick the box to confirm.'; return; }
      const btn = sheet.querySelector('button[type=submit]');
      btn.disabled = true;
      msg.textContent = on ? 'Encrypting…' : '';
      try {
        if (on) await enableEncryption(ctx.state, pin);
        else await disableEncryption(ctx.state);
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
        return;
      }
      ctx.commit();
      ctx.closeSheet();
      ctx.toast(on ? 'Your data is now encrypted with your PIN' : 'Encryption turned off');
    });
  });
}

export function onClick(act) {
  if (act === 'enc-on') { encryptSheet(true); return true; }
  if (act === 'enc-off') { encryptSheet(false); return true; }
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

