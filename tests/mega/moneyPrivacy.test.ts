// Copied from Life System (MEGA origin/main 0d94e87: src/core/moneyPrivacy.test.ts) by scripts/port-mega-tests.mjs. 1 test(s) that need Life System code (./moneyText) are left out.
import { afterEach, beforeEach, describe, expect, it, vi } from './_vitest.js'
// @ts-ignore plain JS modules shared with the embedded Finance Helper
import * as Money from '../../js/money.js'
// @ts-ignore
import * as P from '../../js/privacy.js'

const plain = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ')
const store = new Map<string, string>()
const key = (over: Record<string, unknown> = {}, target: unknown = { closest: () => null }) =>
  ({ key: ' ', code: 'Space', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, repeat: false, target, preventDefault: vi.fn(), ...over }) as any

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
  vi.useFakeTimers()
  P._reset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Money.setMoneyHidden(false)
})

describe('money privacy', () => {
  it('starts hidden by default, and shown when "hide when the app opens" is off', () => {
    expect(P.isHidden()).toBe(true)
    P.setHideOnOpen(false)
    P._reset()
    expect(P.isHidden()).toBe(false)
    P.setHideOnOpen(true)
    P._reset()
    expect(P.isHidden()).toBe(true)
  })

  // (left out here: needs Life System code)

  it('Space toggles, is ignored while typing and with a modifier, and a held key toggles once', () => {
    const e = key()
    expect(P.onKey(e)).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(P.isHidden()).toBe(false)
    for (const el of ['input', 'textarea', 'select', '[contenteditable]']) {
      const typing = key({}, { closest: (sel: string) => (sel.includes(el === '[contenteditable]' ? 'contenteditable' : el) ? {} : null) })
      expect(P.onKey(typing)).toBe(false)
      expect(typing.preventDefault).not.toHaveBeenCalled()
    }
    expect(P.isHidden()).toBe(false)
    expect(P.onKey(key({ ctrlKey: true }))).toBe(false)
    expect(P.onKey(key({ key: 'a', code: 'KeyA' }))).toBe(false)
    expect(P.onKey(key({ repeat: true }))).toBe(true)
    expect(P.isHidden()).toBe(false)
    expect(P.onKey(key())).toBe(true)
    expect(P.isHidden()).toBe(true)
  })

  it('a button in focus does not get the Space press: the key-up is swallowed', () => {
    const button = { closest: (sel: string) => (sel.includes('button') ? {} : null) }
    expect(P.onKey(key({}, button))).toBe(true)
    const up = key()
    expect(P.onKeyUp(up)).toBe(true)
    expect(up.preventDefault).toHaveBeenCalled()
    expect(P.onKeyUp(key())).toBe(false)
  })

  it('hides again after the chosen idle time, and input keeps it shown', () => {
    P.setHidden(false)
    P.setHideAfter(5)
    vi.advanceTimersByTime(4 * 60000)
    P.noteActivity({ now: 1 })
    vi.advanceTimersByTime(4 * 60000)
    expect(P.isHidden()).toBe(false)
    vi.advanceTimersByTime(60000 + 1)
    expect(P.isHidden()).toBe(true)
    expect(Money.isMoneyHidden()).toBe(true)
    P.setHidden(false)
    P.setHideAfter(1)
    vi.advanceTimersByTime(60000 + 1)
    expect(P.isHidden()).toBe(true)
  })

  it('"only when I close the window" never hides by itself', () => {
    P.setHideAfter(0)
    P.setHidden(false)
    vi.advanceTimersByTime(3 * 3600000)
    P.onVisibility(true)
    expect(P.isHidden()).toBe(false)
  })

  it('hides when the window is minimised or hidden, and tells listeners', () => {
    P.setHidden(false)
    const seen: boolean[] = []
    P.subscribe((h: boolean) => seen.push(h))
    P.onVisibility(false)
    expect(P.isHidden()).toBe(false)
    P.onVisibility(true)
    expect(P.isHidden()).toBe(true)
    expect(seen).toEqual([true])
  })
})

describe('budget warnings follow the privacy state', async () => {
  // @ts-ignore
  const { amountsHidden } = await import('../../js/budgetwarn.js')
  // @ts-ignore
  const { setMoneyHidden } = await import('../../js/money.js')
  it('amountsHidden is the real state', () => {
    setMoneyHidden(true)
    expect(amountsHidden()).toBe(true)
    setMoneyHidden(false)
    expect(amountsHidden()).toBe(false)
  })
})
