// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeBudgetWarn.test.ts) by scripts/port-mega-tests.mjs. 5 test(s) that need Life System code (../money/budgetWarnRunner, @core/budgetNotice, @core/notifyBudget) are left out.
// Money budget warnings (#8): 80% and 100% of a category's budget, once each per category per
// month, through the 4-a-day push budget. Made-up data; the clock is pinned.
import { afterEach, beforeEach, describe, expect, it, vi } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { setMoneyHidden } from '../../js/money.js'
// @ts-ignore
import { budgetCrossings, newWarnings, warningsOn, thisMonthKeys } from '../../js/budgetwarn.js'

let n = 0
const sp = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ')
const tx = (amount: number, over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: 1, updatedAt: 1, ...over })
const money = (list: any[], budget = 200000, settings: any = {}) => {
  const s = M.normalizeState({ settings: { currency: 'MDL', accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 0 }], ...settings }, tx: list })
  const food = s.settings.categories.find((c: any) => c.id === 'food')
  food.budget = budget
  food.name = 'Food'
  return s
}

const memStore = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), m }
}

beforeEach(() => {
  setMoneyHidden(false)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T12:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('crossing 80% and 100% (Finance numbers)', () => {
  it('finds the level reached; under 80% is nothing', () => {
    expect(budgetCrossings(money([tx(150000)]), '2026-11-17')).toEqual([])
    expect(budgetCrossings(money([tx(160000)]), '2026-11-17')).toMatchObject([{ month: '2026-11', cat: 'food', name: 'Food', level: 80, pct: 80, spent: 160000, budget: 200000 }])
    expect(budgetCrossings(money([tx(200000)]), '2026-11-17')[0].level).toBe(100)
    // Last month's spending and refunds count like everywhere else.
    expect(budgetCrossings(money([tx(190000, { date: '2026-10-20' })]), '2026-11-17')).toEqual([])
    expect(budgetCrossings(money([tx(170000), { ...tx(20000), type: 'income', refund: true }]), '2026-11-17')).toEqual([])
  })

  it('80% then 100% fire once each; a jump past both sends only 100%; next month starts over', () => {
    let sent: string[] = []
    const step = (s: any, day: string) => { const r = newWarnings(budgetCrossings(s, day), thisMonthKeys(sent, day.slice(0, 7))); sent = r.keys; return r.warn.map((w: any) => w.level) }
    expect(step(money([tx(170000)]), '2026-11-17')).toEqual([80])
    expect(step(money([tx(180000)]), '2026-11-18')).toEqual([])
    expect(step(money([tx(210000)]), '2026-11-19')).toEqual([100])
    expect(step(money([tx(260000)]), '2026-11-20')).toEqual([])
    // A new month with spending already past 100% at once: one warning, the 100% one.
    expect(step(money([tx(250000, { date: '2026-12-02' })]), '2026-12-02')).toEqual([100])
    expect(step(money([tx(250000, { date: '2026-12-02' })]), '2026-12-03')).toEqual([])
  })

  it('switch: on by default, off with settings.budgetWarn = false', () => {
    expect(warningsOn(money([]))).toBe(true)
    expect(warningsOn(money([], 1, { budgetWarn: false }))).toBe(false)
  })
})

describe('the notification', () => {
  const c = { month: '2026-11', cat: 'food', name: 'Food', level: 80 as const, pct: 80, spent: 160000, budget: 200000 }
  // (left out here: needs Life System code)

  // (left out here: needs Life System code)

  // (left out here: needs Life System code)
})

// (left out here: needs Life System code)
