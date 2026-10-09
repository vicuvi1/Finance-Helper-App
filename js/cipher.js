// Encryption for your data: AES-256-GCM with a key made from your PIN
// (PBKDF2-SHA256, its own salt). Used for the data on this device, the copy
// in Google Drive and backups when "Encrypt my data" is on.

const ITER = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(pin, salt, iterations = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// { fh: 'enc1', salt, iter, iv, ct } — salt and iter say how to rebuild the key.
export async function seal(text, key, salt, iterations = ITER) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { fh: 'enc1', salt, iter: iterations, iv: b64(iv), ct: b64(ct) };
}

export async function open(box, key) {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return dec.decode(pt);
  } catch {
    throw new Error('Wrong PIN, or the data was made with another PIN.');
  }
}

export const isSealed = (x) => !!x && typeof x === 'object' && x.fh === 'enc1' && typeof x.ct === 'string';

// Opens a sealed box with a PIN, deriving the key from the box's own salt.
export async function openWithPin(box, pin) {
  return open(box, await deriveKey(pin, box.salt, box.iter || ITER));
}
