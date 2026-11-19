// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeMoneyB2.test.ts) by scripts/port-mega-tests.mjs.
// Money batch 2 (finance js/budgetsuggest.js, monthreview.js, subslist.js):
// budgets from the last 3 months, the month review on the 1st to 7th, the net
// worth line, subscriptions with their yearly cost, and the new settings keys
// surviving a sync. Made-up records only; every function gets `today`.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module
import { suggestBudgets, roundUp50 } from '../../js/budgetsuggest.js'
// @ts-ignore plain JS module
import { monthReview, reviewMonthKey, dismissedReviews, dismissReview, netWorthLine } from '../../js/monthreview.js'
// @ts-ignore plain JS module
import { subscriptionRows, setSubAnswer } from '../../js/subslist.js'
// @ts-ignore plain JS module
import * as M from '../../js/model.js'
// @ts-ignore plain JS module
import { mergeStates, toCloud } from '../../js/sync.js'

let n = 0
const tx = (over: Record<string, any> = {}) => {
  const amount = over.amount ?? 10000
  return { id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-10-10', category: 'food', account: 'cash', createdAt: n, updatedAt: n, ...over }
}
const cats = [
  { id: 'work', type: 'income', name: 'Work' },
  { id: 'food', type: 'expense', name: 'Food'  },
  { id: 'fun', type: 'expense', name: 'Fun' },
  { id: 'fees', type: 'expense', name: 'Work fees', workCost: true }
]
const mk = (txs: any[], over: Record<string, any> = {}) => {
  const s = M.normalizeState({ settings: { currency: 'MDL', categories: cats, accounts: [{ id: 'cash', name: 'Cash', kind: 'cash', currency: 'MDL', start: 100000 }], ...(over.settings || {}) }, tx: txs, recurring: over.recurring || [] })
  for (const c of s.settings.categories) delete c.budget
  return s
}

describe('budgets from the last 3 months', () => {
  const state = () => mk([
    tx({ amount: 31000, date: '2026-09-05' }), tx({ amount: 45000, date: '2026-10-05' }), tx({ amount: 60000, date: '2026-11-05' }),
    tx({ amount: 150000, date: '2026-10-20' }), // one-off (over 1 000): left out
    tx({ amount: 90000, date: '2026-11-06', category: 'fees' }), // work cost: left out
    tx({ amount: 9000, date: '2026-09-09', category: 'fun' }),
    tx({ amount: 99000, date: '2026-12-01' }), // this month: not counted
    tx({ amount: 20000, date: '2026-06-01' }) // older than 3 months: not counted
  ])
  it('averages the last 3 full months, rounded up to 50, without one-offs or work costs', () => {
    const rows = suggestBudgets(state(), '2026-12-02')
    expect(rows.map((r: any) => r.id)).toEqual(['food', 'fun'])
    expect(rows[0]).toMatchObject({ average: 45333, suggested: 50000, current: null })
    expect(rows[1]).toMatchObject({ average: 3000, suggested: 5000 })
  })
  it('a refund lowers the average, and rounding is up to the next 50', () => {
    const s = state()
    s.tx.push(tx({ type: 'income', refund: true, amount: 10000, date: '2026-11-07' }))
    expect(suggestBudgets(s, '2026-12-02')[0].average).toBe(42000)
    expect(roundUp50(5000)).toBe(5000)
    expect(roundUp50(5001)).toBe(10000)
  })
  it('shows the current budget next to the suggestion', () => {
    const s = state()
    s.settings.categories.find((c: any) => c.id === 'food').budget = 40000
    expect(suggestBudgets(s, '2026-12-02')[0].current).toBe(40000)
  })
})

describe('month review', () => {
  const state = () => mk([
    tx({ type: 'income', category: 'work', amount: 500000, date: '2026-11-01' }),
    tx({ amount: 100000, date: '2026-10-05', category: 'fun' }),
    tx({ amount: 80000, date: '2026-11-05', category: 'food' }),
    tx({ amount: 60000, date: '2026-11-06', category: 'fun' })
  ])
  it('shows on the 1st to the 7th only, for the month before', () => {
    expect(reviewMonthKey('2026-12-01')).toBe('2026-11')
    expect(reviewMonthKey('2026-12-07')).toBe('2026-11')
    expect(reviewMonthKey('2026-12-08')).toBeNull()
    expect(monthReview(state(), '2026-12-08')).toBeNull()
    expect(monthReview(state(), '2026-12-03')).not.toBeNull()
  })
  it('has the right numbers', () => {
    const r = monthReview(state(), '2026-12-03')
    expect(r.spent).toBe(140000)
    expect(r.prevSpent).toBe(100000)
    expect(Math.round(r.change * 100)).toBe(40)
    expect(r.top).toMatchObject({ name: 'Food', diff: 80000 })
    expect(Math.round(r.rate * 100)).toBe(72)
    expect(r.over).toEqual([])
  })
  it('names a budget that went over and offers a number', () => {
    const s = state()
    s.settings.categories.find((c: any) => c.id === 'food').budget = 57000
    const r = monthReview(s, '2026-12-03')
    expect(r.over[0]).toMatchObject({ name: 'Food', pct: 40 })
    expect(r.tip.text).toContain('Food was 40% over budget: raise it to')
    expect(r.tip.raiseTo).toBe(80000)
  })
  it('a refund lowers the spending', () => {
    const s = state()
    s.tx.push(tx({ type: 'income', refund: true, category: 'fun', amount: 10000, date: '2026-11-08' }))
    expect(monthReview(s, '2026-12-03').spent).toBe(130000)
  })
  it('dismissing hides it for that month on this device only', () => {
    const mem: Record<string, string> = {}
    const storage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v } }
    expect(dismissedReviews(storage)).toEqual([])
    dismissReview('2026-11', storage)
    expect(dismissedReviews(storage)).toEqual(['2026-11'])
    expect(dismissedReviews({ getItem: () => { throw new Error('blocked') } } as any)).toEqual([])
  })
})

describe('net worth line', () => {
  const state = () => mk([
    tx({ amount: 10000, date: '2026-09-10' }),
    tx({ type: 'income', category: 'work', amount: 50000, date: '2026-10-15' }),
    tx({ amount: 20000, date: '2026-11-20' })
  ])
  it('has the month-end balances and today', () => {
    const nw = netWorthLine(state(), '2026-12-05')
    const at = (k: string) => nw.points.find((p: any) => p.key === k).value
    expect(at('2026-09')).toBe(90000)
    expect(at('2026-10')).toBe(140000)
    expect(at('2026-11')).toBe(120000)
    expect(nw.points.at(-1)).toMatchObject({ key: '2026-12', value: 120000 })
    expect(nw.now).toBe(120000)
    expect(nw.change).toBe(nw.now - nw.first)
  })
  it('is hidden with fewer than 2 points', () => {
    expect(netWorthLine(mk([]), '2026-12-05')).toBeNull()
  })
})

describe('subscriptions per year', () => {
  const rec = { id: 'r1', type: 'expense', amount: 9900, currency: 'MDL', account: 'cash', category: 'fun', note: 'Music app', every: 'month', start: '2026-09-03', lastDone: '2026-11-03', paused: false }
  it('shows a monthly one with per year = 12 x amount and the next date', () => {
    const { rows, total } = subscriptionRows(mk([], { recurring: [rec] }), '2026-12-02')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Music app', every: 'monthly', yearly: 9900 * 12, next: '2026-12-03' })
    expect(total).toBe(118800)
  })
  it('finds a monthly payment that is not set up yet', () => {
    const s = mk(['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05'].map((d) => tx({ amount: 5000, date: d, note: 'Cloud storage' })))
    const { rows } = subscriptionRows(s, '2026-12-02')
    expect(rows[0]).toMatchObject({ name: 'Cloud storage', yearly: 60000 })
  })
  it('Keep and remind change nothing but the two fields, and clear again', () => {
    const s = mk([], { recurring: [rec] })
    const before = JSON.stringify({ r: s.recurring, t: s.tx })
    expect(setSubAnswer(s, 'rec:r1', 'keep', '2026-12-02')).toBe(true)
    expect(setSubAnswer(s, 'rec:r1', 'remind', '2026-12-02')).toBe(true)
    const row = subscriptionRows(s, '2026-12-02').rows[0]
    expect(row).toMatchObject({ kept: '2026-12-02', remind: '2026-12-02' })
    expect(JSON.stringify({ r: s.recurring, t: s.tx })).toBe(before)
    expect(setSubAnswer(s, 'rec:r1', 'unkeep', '2026-12-02')).toBe(true)
    expect(setSubAnswer(s, 'rec:r1', 'unremind', '2026-12-02')).toBe(true)
    expect(setSubAnswer(s, 'rec:r1', 'unkeep', '2026-12-02')).toBe(false)
  })
  it('the answers survive a save and a sync round trip', () => {
    const a = mk([], { recurring: [rec] })
    const b = mk([], { recurring: [rec] })
    setSubAnswer(b, 'rec:r1', 'keep', '2026-12-02', Date.now() + 5000)
    setSubAnswer(b, 'rec:r1', 'remind', '2026-12-02', Date.now() + 5000)
    const { state } = mergeStates(a, toCloud(b, 'dev-b'))
    expect(state.settings.subsKept).toEqual({ 'rec:r1': '2026-12-02' })
    expect(state.settings.subsRemind).toEqual({ 'rec:r1': '2026-12-02' })
    const again = M.normalizeState(JSON.parse(JSON.stringify(state)))
    expect(again.settings.subsKept['rec:r1']).toBe('2026-12-02')
  })
})
