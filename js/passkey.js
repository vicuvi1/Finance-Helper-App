// Sign in with your fingerprint, face or Windows Hello (a passkey) on the web
// app, instead of typing the server PIN. The server (api/_passkey.mjs) issues
// a one-time challenge and checks every answer; this file only talks to the
// browser. A passkey is made after a PIN sign-in, on this device only.
// The desktop app keeps the PIN: its app:// address can't hold a passkey for the site.

export const b64u = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromB64u = (text) => {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(text).length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const FLAG = 'fh-passkey';
/** Whether this device made a passkey (so the sign-in sheet offers it first). */
// The value is the passkey's id (to mark "this device" in the Devices list).
export const localPasskeyId = (store = globalThis.localStorage) => { try { return store?.getItem(FLAG) || ''; } catch { return ''; } };
export const hasLocalPasskey = (store = globalThis.localStorage) => !!localPasskeyId(store);
export const setLocalPasskey = (id, store = globalThis.localStorage) => { try { if (id) store.setItem(FLAG, id === true ? '1' : String(id)); else store.removeItem(FLAG); } catch { /* private window */ } };

/** Passkeys can work here: a browser with WebAuthn, on an https site (or localhost). */
export function passkeyPossible(win = globalThis) {
  return !!(win.PublicKeyCredential && win.navigator?.credentials && win.isSecureContext && /^https?:$/.test(win.location?.protocol || ''));
}

/** Whether this device has a fingerprint / face / Windows Hello reader. */
export async function hasReader(win = globalThis) {
  try { return passkeyPossible(win) && await win.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

/** Makes a passkey for {challenge} and returns what the server checks. */
export async function makePasskey({ challenge, credentials = [] }, { label = 'This device' } = {}) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(challenge),
      rp: { name: 'Finance Helper', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Finance Helper', displayName: 'Finance Helper' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      excludeCredentials: credentials.map((id) => ({ type: 'public-key', id: fromB64u(id) })),
      timeout: 60000,
      attestation: 'none',
    },
  });
  const r = cred.response;
  if (!r.getPublicKey || !r.getAuthenticatorData) throw new Error('This browser is too old for fingerprint sign-in. Update it, or keep using the PIN.');
  return {
    credentialId: cred.id,
    clientDataJSON: b64u(r.clientDataJSON),
    authenticatorData: b64u(r.getAuthenticatorData()),
    publicKey: b64u(r.getPublicKey()),
    alg: r.getPublicKeyAlgorithm(),
    label,
  };
}

/** Asks for the fingerprint / face for {challenge, credentials}; returns what the server checks. */
export async function usePasskey({ challenge, credentials = [] }) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      rpId: location.hostname,
      allowCredentials: credentials.map((id) => ({ type: 'public-key', id: fromB64u(id) })),
      userVerification: 'required',
      timeout: 60000,
    },
  });
  const r = cred.response;
  return { credentialId: cred.id, clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature) };
}

/** A device name for the Devices list, from the browser. */
export function deviceLabel(ua = globalThis.navigator?.userAgent || '') {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows PC' : /Mac OS/.test(ua) ? 'Mac' : 'This device';
  return `${os} (fingerprint)`;
}
