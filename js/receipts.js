// Receipts on records (Money v2 phase 3, plan D6). Finance Helper never keeps
// or uploads the file itself: it hands it to Life System (the page it runs
// in, same origin), which keeps a copy on this device (IndexedDB
// life-receipts) and uploads it straight to the owner's Google Drive
// ("Life System/Receipts/YYYY-MM", drive.file). The record keeps only the
// receipt ids (t.receipts = ['r-…']); names, sizes and Drive ids live in
// Life's own setting money_receipts, outside Finance's data.
//
// Outside Life System (Finance on its own) there is no one to hand the file
// to, so the receipt button is hidden.

import { touch, uid } from './model.js';

export const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
export const RECEIPT_TYPES = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;

export const newReceiptId = () => `r-${uid()}`;
export const receiptIds = (t) => (Array.isArray(t?.receipts) ? t.receipts.filter((r) => typeof r === 'string') : []);

// Adds a receipt id to a record (touched, so it wins in a sync). Returns false
// when it was already there.
export function addReceiptId(t, rid, now = Date.now()) {
  const ids = receiptIds(t);
  if (ids.includes(rid)) return false;
  t.receipts = [...ids, rid];
  touch(t, now);
  return true;
}

// Takes a receipt off a record only (the file stays on this device and in Drive).
export function removeReceiptId(t, rid, now = Date.now()) {
  const ids = receiptIds(t);
  if (!ids.includes(rid)) return false;
  const left = ids.filter((x) => x !== rid);
  if (left.length) t.receipts = left; else delete t.receipts;
  touch(t, now);
  return true;
}

// 'drive' (backed up), 'local' (on this device, waiting for Drive), 'gone'
// (removed) or 'unknown' (this device has not heard of it yet).
export function receiptStatus(index, rid) {
  const r = index?.[rid];
  if (!r) return 'unknown';
  if (r.gone) return 'gone';
  return r.driveId ? 'drive' : 'local';
}

// Receipts on records that are not in Drive yet (for the warning line).
export function notInDrive(state, index) {
  let n = 0;
  for (const t of state.tx) for (const rid of receiptIds(t)) if (receiptStatus(index, rid) !== 'drive' && receiptStatus(index, rid) !== 'gone') n++;
  return n;
}

export function checkFile(file) {
  if (!file) return 'No file picked';
  if (!RECEIPT_TYPES.test(file.type || '')) return 'A receipt is a photo (JPEG, PNG, WebP, HEIC) or a PDF';
  if (file.size > MAX_RECEIPT_BYTES) return 'That file is over 20 MB';
  return null;
}

// ---------- Talking to Life System ----------

export const inLife = () => {
  try { return typeof window !== 'undefined' && window.parent && window.parent !== window; } catch { return false; }
};

let index = {};
const listeners = new Set();
export const receiptIndex = () => index;
export function onIndex(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setIndex(items) {
  if (!items || typeof items !== 'object') return;
  index = { ...index, ...items };
  for (const fn of listeners) { try { fn(index); } catch { /* a screen gone */ } }
}

const waiting = new Map();
let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'LIFE_FINANCE_RECEIPT') return;
    const d = e.data;
    if (d.items) setIndex(d.items);
    const w = d.req && waiting.get(d.req);
    if (w) { waiting.delete(d.req); clearTimeout(w.timer); if (d.ok) w.ok(d); else w.no(new Error(d.error || 'Life System could not do that')); }
  });
}

function ask(action, payload, { timeout = 20000, transfer } = {}) {
  listen();
  return new Promise((ok, no) => {
    if (!inLife()) return no(new Error('Receipts work inside Life System'));
    const req = `rq-${uid()}`;
    const timer = setTimeout(() => { waiting.delete(req); no(new Error('Life System did not answer')); }, timeout);
    waiting.set(req, { ok, no, timer });
    try { window.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action, payload: { ...payload, req } }, location.origin, transfer || []); } catch (err) { clearTimeout(timer); waiting.delete(req); no(err); }
  });
}

// Hands a file to Life System. Resolves with the new receipt id once Life
// has kept it on this device (the Drive upload follows by itself).
export async function sendReceipt(t, file) {
  const bad = checkFile(file);
  if (bad) throw new Error(bad);
  const bytes = await file.arrayBuffer();
  const rid = newReceiptId();
  const r = await ask('FINANCE_RECEIPT_ADD', { rid, txId: t.id, date: t.date, note: t.note || '', name: file.name || 'receipt', mime: file.type, bytes }, { timeout: 30000 });
  return r.rid || rid;
}

// What Life knows about these receipts (status, names, Drive ids).
export async function refreshIndex(ids) {
  if (!inLife()) return index;
  const r = await ask('FINANCE_RECEIPT_INDEX', { ids: ids || null }).catch(() => null);
  return r ? index : index;
}

// The file for viewing: from this device, or downloaded from Drive.
export const openReceipt = (rid) => ask('FINANCE_RECEIPT_OPEN', { rid }, { timeout: 60000 });
// Sign in to Google again with Drive (only the app's own files).
export const connectDrive = () => ask('FINANCE_RECEIPT_CONNECT', {}, { timeout: 180000 });
