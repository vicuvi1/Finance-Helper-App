// App lock: a PIN or password asked on start and after you've been away.
// Only a salted PBKDF2 hash is stored (per device, never synced). "Encrypt
// my data" derives a separate AES key from the same PIN with its own salt
// (js/cipher.js, js/store.js).

const ITERATIONS = 210000;
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
  return b64(bits);
}

export function validPin(pin) {
  const p = String(pin || '');
  if (p.length < 4) return 'Use at least 4 characters.';
  if (p.length > 64) return 'Use at most 64 characters.';
  return null;
}

// What gets stored for a new PIN.
export async function createLock(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, salt: b64(salt), iterations: ITERATIONS, hash: await derive(pin, salt, ITERATIONS) };
}

export async function checkPin(lock, pin) {
  if (!lock?.hash) return false;
  const h = await derive(String(pin), unb64(lock.salt), lock.iterations || ITERATIONS);
  // Constant-time compare.
  let diff = h.length ^ lock.hash.length;
  for (let i = 0; i < Math.min(h.length, lock.hash.length); i++) diff |= h.charCodeAt(i) ^ lock.hash.charCodeAt(i);
  return diff === 0;
}

// After 5 wrong tries, wait 30 s, doubling each further miss (max 15 min).
export function waitAfter(fails) {
  if (fails < 5) return 0;
  return Math.min(15 * 60, 30 * 2 ** (fails - 5)) * 1000;
}
