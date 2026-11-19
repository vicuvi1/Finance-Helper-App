// POST /api/login {pin} → {session}
// POST /api/login {renew: session} → {session}: a signed-in device swaps its
// still-valid session for a fresh 14-day one while it is used (sliding expiry, LT3).
// POST /api/login {signOutAll: session} → {session}: every other device has
// to enter the PIN again (this one gets a fresh session).
// POST /api/login {passkey:'options'|'register'|'login', …}: fingerprint/face unlock (_passkey.mjs).
// POST /api/login {devices: session} → your devices and passkeys; {revokeDevice: sid | revokePasskey: id, session} (A6).
// POST /api/login {changePin: session, current, pin} → {session}: the new PIN, checked here (A2).
// POST /api/login {setup: <server setup key>, pin} → {session}: the FIRST PIN, only while none is set
// (the key is CRON_SECRET or PIN_SETUP_SECRET from the server's environment; there is no default PIN).
// A PIN login answers 409 {setup: true} while no PIN is set.
// A PIN login may send {prev: <old session>} so the device keeps its id.
import { changePin, clientIp, config, liveEpoch, login, makeSession, readBody, resetPin, send, sessionOk, sessionSigned, setupPin, sidOf, signOutAll } from './_lib.mjs'
import { expectedSite, passkeyLogin, passkeyOptions, passkeyRegister } from './_passkey.mjs'
import { listDevices, removePasskey, revokeDevice, touchDevice } from './_devices.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  // Every session handed out here records its device (A6).
  const reply = async (code, body) => {
    const sid = body?.session ? sessionSigned(cfg, body.session)?.sid : null
    if (sid) await touchDevice(cfg, sid, req.headers?.['user-agent'])
    return send(res, code, body)
  }
  try {
    const body = await readBody(req)
    const { pin, renew, signOutAll: all } = body
    // Devices (A6): list, sign one out, remove a passkey. Needs a valid session.
    if (body.devices || body.revokeDevice || body.revokePasskey) {
      const token = body.devices || body.session
      if (!(await sessionOk(cfg, token))) return send(res, 401, { error: 'Session expired: enter your PIN' })
      if (body.revokeDevice) await revokeDevice(cfg, body.revokeDevice)
      if (body.revokePasskey) await removePasskey(cfg, body.revokePasskey)
      return send(res, 200, { ...(await listDevices(cfg)), current: sessionSigned(cfg, token)?.sid ?? null })
    }
    // Passkeys (M7): options for either step; registering needs your session (PIN first).
    if (body.passkey === 'options') return send(res, 200, await passkeyOptions(cfg, body.op))
    if (body.passkey === 'register') {
      if (!(await sessionOk(cfg, body.session))) return send(res, 401, { error: 'Unlock with your PIN first' })
      return send(res, 200, await passkeyRegister(cfg, body, expectedSite(req), Date.now(), fetch, sessionSigned(cfg, body.session)?.sid ?? null))
    }
    // The first PIN: only while none is set, with the server's setup key.
    if (body.setup) {
      const r = await setupPin(cfg, body.setup, pin, Date.now(), fetch, clientIp(req))
      return r.body?.session ? reply(r.status, r.body) : send(res, r.status, r.body)
    }
    // Forgot the PIN: the server's setup key sets a new one and signs every other device out.
    if (body.reset) {
      const r = await resetPin(cfg, body.reset, pin, Date.now(), fetch, clientIp(req))
      return r.body?.session ? reply(r.status, r.body) : send(res, r.status, r.body)
    }
    // A new PIN (A2): your session AND the current PIN, both checked here.
    if (body.changePin) {
      if (!(await sessionOk(cfg, body.changePin))) return send(res, 401, { error: 'Session expired: enter your PIN' })
      const r = await changePin(cfg, body.current, body.pin, sessionSigned(cfg, body.changePin)?.sid, Date.now(), fetch, clientIp(req))
      return r.body?.session ? reply(r.status, r.body) : send(res, r.status, r.body)
    }
    if (body.passkey === 'login') {
      try {
        return reply(200, await passkeyLogin(cfg, body, expectedSite(req)))
      } catch (e) {
        return send(res, 401, { error: e.message || 'Passkey failed' })
      }
    }
    if (all) return (await sessionOk(cfg, all)) ? reply(200, { session: await signOutAll(cfg, Date.now(), fetch, sessionSigned(cfg, all)?.sid ?? null) }) : send(res, 401, { error: 'Session expired: enter your PIN' })
    if (renew) {
      // Renewing keeps the same device id.
      if (!(await sessionOk(cfg, renew))) return send(res, 401, { error: 'Session expired: enter your PIN' })
      const sid = sessionSigned(cfg, renew)?.sid
      return reply(200, { session: makeSession(cfg, Date.now(), await liveEpoch(cfg), sid || undefined) })
    }
    const r = await login(cfg, pin, Date.now(), fetch, clientIp(req), sidOf(cfg, body.prev))
    return r.body?.session ? reply(r.status, r.body) : send(res, r.status, r.body)
  } catch (e) {
    send(res, 502, { error: e.message || 'Login failed' })
  }
}
