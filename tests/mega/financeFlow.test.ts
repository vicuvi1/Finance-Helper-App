// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeFlow.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper's feel (js/flow.js) and tips (js/tips.js): numbers count but
// never show digits while amounts are hidden, everything switches off with
// reduced motion / Calm, rows diff correctly, tips are shown once.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module
import { countTo, countValue, motionOff, diffRows, flowOff, PREF_KEY } from '../../js/flow.js'
// @ts-ignore plain JS module
import { tipFor, tipHTML, dismissTip, setTipsOn, tipsOn, emptyState, EMPTY, TIPS, settingsRow } from '../../js/tips.js'
// @ts-ignore plain JS module
import { formatMoney, setMoneyHidden } from '../../js/money.js'

const fakeEl = () => ({ textContent: '', isConnected: true })
// A clock and a frame queue we drive by hand.
function loop() {
  let t = 0
  const q: (() => void)[] = []
  return {
    now: () => t,
    raf: (f: () => void) => void q.push(f),
    tick(ms: number) {
      t += ms
      const run = q.splice(0)
      run.forEach((f) => f())
    },
    pending: () => q.length
  }
}
const store = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as any
}

describe('count-up', () => {
  it('rolls from the old number to the new one and ends exactly on it', () => {
    const el = fakeEl()
    const l = loop()
    const seen: number[] = []
    const r = countTo(el, { from: 100000, to: 250000, fmt: (v: number) => (seen.push(v), String(v)), now: l.now, raf: l.raf })
    expect(r).toBe('run')
    expect(el.textContent).toBe('100000')
    l.tick(200)
    expect(Number(el.textContent)).toBeGreaterThan(100000)
    expect(Number(el.textContent)).toBeLessThan(250000)
    l.tick(2000)
    expect(el.textContent).toBe('250000')
    expect(l.pending()).toBe(0)
  })

  it('never formats a digit while amounts are hidden: it jumps to the masked final text', () => {
    const el = fakeEl()
    const l = loop()
    const seen: number[] = []
    const r = countTo(el, { from: 100000, to: 250000, fmt: (v: number) => (seen.push(v), '••••'), hidden: () => true, now: l.now, raf: l.raf })
    expect(r).toBe('hidden')
    expect(el.textContent).toBe('••••')
    expect(seen).toEqual([250000]) // only the final value, formatted by the masking formatter
    expect(l.pending()).toBe(0)
  })

  it('with the real formatter, hiding in the middle of a count leaves only dots', () => {
    const el = fakeEl()
    const l = loop()
    let hidden = false
    setMoneyHidden(false)
    countTo(el, { from: 100000, to: 250000, fmt: (v: number) => formatMoney(v, ''), hidden: () => hidden, now: l.now, raf: l.raf })
    l.tick(100)
    expect(el.textContent).toMatch(/\d/)
    hidden = true
    setMoneyHidden(true)
    const texts: string[] = []
    for (let i = 0; i < 6; i++) { l.tick(120); texts.push(el.textContent) }
    setMoneyHidden(false)
    expect(texts.every((x) => !/\d/.test(x))).toBe(true)
  })

  it('does not animate with motion off, and not when nothing changed', () => {
    const el = fakeEl()
    const l = loop()
    expect(countTo(el, { from: 1, to: 500, fmt: String, off: () => true, now: l.now, raf: l.raf })).toBe('off')
    expect(el.textContent).toBe('500')
    expect(l.pending()).toBe(0)
    expect(countTo(el, { from: 5, to: 5, fmt: String, now: l.now, raf: l.raf })).toBe('same')
  })

  it('counts in whole units unless the value has bani, and stops if the element is gone', () => {
    expect(countValue(0, 123400, 0.4) % 100).toBe(0)
    expect(countValue(0, 123456, 0.4) % 1).toBe(0)
    expect(countValue(0, 123456, 1)).toBe(123456)
    const el = fakeEl()
    const l = loop()
    countTo(el, { from: 0, to: 100000, fmt: String, now: l.now, raf: l.raf })
    el.isConnected = false
    l.tick(100)
    expect(l.pending()).toBe(0)
  })
})

describe('reduced motion and Calm switch everything off', () => {
  it('motionOff', () => {
    expect(motionOff({})).toBe(false)
    expect(motionOff({ reduced: true })).toBe(true)
    expect(motionOff({ calm: true })).toBe(true)
    expect(motionOff({ pref: 'off' })).toBe(true)
    expect(motionOff({ pref: 'on' })).toBe(false)
  })

  it('flowOff reads the system setting, Life System Calm mode and the device switch', () => {
    const win = (o: { reduced?: boolean; calm?: boolean; pref?: string; inLife?: boolean }) => {
      const self: any = {
        matchMedia: () => ({ matches: !!o.reduced }),
        localStorage: { getItem: (k: string) => (k === PREF_KEY ? o.pref ?? null : null) }
      }
      self.parent = o.inLife ? { document: { documentElement: { classList: { contains: (c: string) => c === 'calm' && !!o.calm } } } } : self
      return self
    }
    expect(flowOff(win({}))).toBe(false)
    expect(flowOff(win({ reduced: true }))).toBe(true)
    expect(flowOff(win({ inLife: true, calm: true }))).toBe(false) // Calm does not affect Money's motion
    expect(flowOff(win({ inLife: true, calm: false }))).toBe(false)
    expect(flowOff(win({ pref: 'off' }))).toBe(true)
    expect(flowOff(null as any)).toBe(true)
  })
})

describe('rows that ease in and out', () => {
  const m = (o: Record<string, string>) => new Map(Object.entries(o))
  it('finds added, removed and edited rows', () => {
    const d = diffRows(m({ a: '1', b: '2', c: '3' }), m({ a: '1', b: '22', d: '4' }))
    expect(d).toMatchObject({ added: ['d'], changed: ['b'], removed: ['c'], bulk: false })
  })
  it('a big change (import, month switch, sync) is not animated row by row', () => {
    const next: Record<string, string> = {}
    for (let i = 0; i < 20; i++) next[`n${i}`] = 'x'
    expect(diffRows(m({ a: '1' }), m(next)).bulk).toBe(true)
  })
  it('nothing changed, nothing animates', () => {
    expect(diffRows(m({ a: '1' }), m({ a: '1' }))).toMatchObject({ added: [], changed: [], removed: [] })
  })
})

describe('tips', () => {
  it('shows one tip per screen until it is closed, then never again', () => {
    const s = store()
    expect(tipFor('home', s)?.id).toBe(TIPS.home.id)
    expect(tipHTML('home', s)).toContain('Space')
    dismissTip(TIPS.home.id, s)
    expect(tipFor('home', s)).toBeNull()
    expect(tipHTML('home', s)).toBe('')
    expect(tipFor('log', s)).not.toBeNull()
    expect(tipFor('settings', s)).toBeNull()
  })
  it('the Tips switch turns them all off, and on again brings them back', () => {
    const s = store()
    setTipsOn(false, s)
    expect(tipsOn(s)).toBe(false)
    expect(tipFor('log', s)).toBeNull()
    expect(settingsRow(s)).not.toContain('checked')
    dismissTip(TIPS.log.id, s)
    setTipsOn(true, s)
    expect(tipsOn(s)).toBe(true)
    expect(tipFor('log', s)?.id).toBe(TIPS.log.id)
    expect(settingsRow(s)).toContain('checked')
  })
  it('a broken or missing store never throws', () => {
    expect(tipFor('home', null as any)?.id).toBe('space')
    expect(() => dismissTip('x', { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } } as any)).not.toThrow()
  })
})

describe('empty states', () => {
  it('say what it is for, give one example and one button', () => {
    const html = EMPTY.goals()
    expect(html).toContain('Save for something')
    expect(html).toContain('Example:')
    expect(html).toContain('data-act="goal-new"')
    expect(html).toContain('Add a goal')
    expect((html.match(/<button/g) || []).length).toBe(1)
  })
  it('budgets, subscriptions, long view and the log have their own', () => {
    expect(EMPTY.budgets()).toContain('budget-set')
    expect(EMPTY.subscriptions()).toContain('rec-new')
    expect(EMPTY.longview()).toContain('Your long view')
    expect(EMPTY.log(false)).toContain('Add a record')
    expect(EMPTY.log('coffee')).toBe('')
    expect(EMPTY.wishlist()).toContain('Example:')
  })
  it('escapes what it is given', () => {
    expect(emptyState({ title: '<b>x</b>', button: { label: 'a"b', act: 'go' } })).not.toContain('<b>x</b>')
  })
})
