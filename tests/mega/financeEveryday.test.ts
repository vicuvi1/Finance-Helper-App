// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeEveryday.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper "Everyday only": what it leaves out (work-cost categories and
// one-off records at or above the everyday limit), the limit in other main
// currencies, "Everything" staying as it was, and the new category / settings
// fields surviving a save and a sync round trip. Made-up records only.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module from the embedded app
import { everydayList, everydayLimit, isOneOff, DEFAULT_LIMIT_MDL } from '../../js/everyday.js'
// @ts-ignore plain JS module from the embedded app
import { categoryShares, spendRange } from '../../js/catshare.js'
// @ts-ignore plain JS module from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore plain JS module from the embedded app
import { mergeStates, toCloud } from '../../js/sync.js'
import { FINANCE } from './_life.js'

let n = 0
const tx = (over: Record<string, unknown> = {}) => ({ id: `t${++n}`, type: 'expense', amount: 5000, base: 5000, date: '2026-11-05', category: 'food', createdAt: n, updatedAt: n, ...over })
const B = (t: any) => (Number.isInteger(t.base) ? t.base : t.amount)
const settings = { currency: 'MDL', categories: [{ id: 'food', type: 'expense', name: 'Food' }, { id: 'fees', type: 'expense', name: 'Work fees', workCost: true }, { id: 'tech', type: 'expense', name: 'Tech' }] }
const ctx = { settings, rates: null, base: B, from: '2026-11-01', to: '2026-11-13' }

describe('everyday limit', () => {
  it('is 1 000 MDL by default and your own number when set', () => {
    expect(everydayLimit({ currency: 'MDL' }, null)).toBe(DEFAULT_LIMIT_MDL)
    expect(everydayLimit({ currency: 'MDL', everydayLimit: 250000 }, null)).toBe(250000)
    expect(everydayLimit({ currency: 'MDL', everydayLimit: 0 }, null)).toBe(DEFAULT_LIMIT_MDL)
  })
  it('converts the default into another main currency with the existing rates', () => {
    const rates = { usd: { USD: 1, MDL: 18, EUR: 0.9 } }
    expect(everydayLimit({ currency: 'USD' }, rates)).toBe(5556) // 1 000 MDL = 55.56 USD
    // No rate known: falls back to the plain number instead of 0.
    expect(everydayLimit({ currency: 'ZZZ' }, rates)).toBe(DEFAULT_LIMIT_MDL)
  })
})

describe('everyday filter', () => {
  it('the limit itself counts as a one-off, one cent under does not', () => {
    expect(isOneOff(tx({ base: 100000 }), 100000, B)).toBe(true)
    expect(isOneOff(tx({ base: 99999 }), 100000, B)).toBe(false)
    expect(isOneOff(tx({ type: 'income', base: 500000 }), 100000, B)).toBe(false)
  })

  it('leaves out work-cost categories and one-offs, and says how much', () => {
    const list = [tx({ base: 5000 }), tx({ category: 'fees', base: 645200 }), tx({ category: 'tech', base: 320000 }), tx({ category: 'tech', base: 90000 }), tx({ category: 'food', base: 100000 })]
    const r = everydayList(list, ctx)
    expect(r.list.map((t: any) => t.base)).toEqual([5000, 90000])
    expect(r.leftOut).toBe(645200 + 320000 + 100000)
  })

  it('a foreign-currency record is judged by its main-currency amount', () => {
    const eur = tx({ amount: 6000, currency: 'EUR', rate: 19.5, base: 117000, category: 'tech' })
    const small = tx({ amount: 4000, currency: 'EUR', rate: 19.5, base: 78000, category: 'tech' })
    const r = everydayList([eur, small], ctx)
    expect(r.list).toEqual([small])
  })

  it('only counts left-out records inside the period', () => {
    const r = everydayList([tx({ category: 'fees', base: 1000, date: '2026-10-02' }), tx({ category: 'fees', base: 2000 })], ctx)
    expect(r.leftOut).toBe(2000)
  })

  it('Everything is untouched: the same totals as the shares on the full list', () => {
    const list = [tx({ base: 5000 }), tx({ category: 'fees', base: 645200 }), tx({ category: 'tech', base: 320000 })]
    const range = spendRange('month', '2026-11-13')
    const all = categoryShares(list, range, B)
    expect(all.total).toBe(5000 + 645200 + 320000)
    const day = categoryShares(everydayList(list, ctx).list, range, B)
    expect(day.total).toBe(5000)
  })
})

describe('work cost and everyday limit survive saving and syncing', () => {
  const base = () => M.normalizeState({ settings: { categories: settings.categories.map((c: any) => ({ ...c, updatedAt: 1 })), everydayLimit: 150000, updatedAt: 1 }, tx: [] })

  it('a save and reload (normalize) keeps both', () => {
    const back = M.normalizeState(JSON.parse(JSON.stringify(base())))
    expect(back.settings.categories.find((c: any) => c.id === 'fees').workCost).toBe(true)
    expect(back.settings.everydayLimit).toBe(150000)
  })

  it('the Drive/Life merge takes them from the newer copy', () => {
    const phone = base()
    const pc = base()
    pc.settings.categories.find((c: any) => c.id === 'food').workCost = true
    pc.settings.categories.find((c: any) => c.id === 'food').updatedAt = 50
    pc.settings.everydayLimit = 200000
    pc.settings.updatedAt = 50
    const merged = mergeStates(phone, { app: 'finance-helper', schema: M.SCHEMA_VERSION, data: toCloud(pc, '').data }).state
    expect(merged.settings.categories.find((c: any) => c.id === 'food').workCost).toBe(true)
    expect(merged.settings.categories.find((c: any) => c.id === 'fees').workCost).toBe(true)
    expect(merged.settings.everydayLimit).toBe(200000)
  })

  it("Life's own finance sync spec shares and restores them too", () => {
    const shared = FINANCE.share!(base()) as any
    expect(shared.settings.everydayLimit).toBe(150000)
    const there = FINANCE.fromShared!(shared) as any
    expect(there.settings.categories.find((c: any) => c.id === 'fees').workCost).toBe(true)
    const merged = FINANCE.merge(base(), shared, false) as any
    expect(merged.settings.everydayLimit).toBe(150000)
    expect(merged.settings.categories.find((c: any) => c.id === 'fees').workCost).toBe(true)
  })
})

// "Where your money goes": callout labels on the donut never sit closer than the gap.
// @ts-ignore plain JS module from the embedded app
import { spreadLabels } from '../../js/donutlabels.js'
describe('donut callout labels', () => {
  it('pushes neighbouring small slices apart and keeps their order', () => {
    const ys: number[] = spreadLabels([{ y: 40 }, { y: 44 }, { y: 47 }, { y: 150 }], { gap: 18, top: 14, bottom: 286 })
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(18)
    expect(ys[3]).toBe(150)
  })
  it('stays inside the picture when the labels crowd the bottom', () => {
    const ys: number[] = spreadLabels([{ y: 280 }, { y: 284 }, { y: 290 }], { gap: 18, top: 14, bottom: 286 })
    expect(Math.max(...ys)).toBeLessThanOrEqual(286)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(14)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(18)
  })
  it('returns heights in the order given', () => {
    expect(spreadLabels([{ y: 100 }, { y: 20 }], { gap: 18, top: 14, bottom: 286 })).toEqual([100, 20])
  })
})
