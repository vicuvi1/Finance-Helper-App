// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyNotIncome.test.ts) by scripts/port-mega-tests.mjs. 3 test(s) that need Life System code (./moneyHub, @core/moneyHub) are left out.
// "Doesn't count as income / spending": records that move a balance but are left
// out of every income and spending total. Made-up data only; the clock is passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { countsAsIncome, countsAsSpending, isNotCounted } from '../../js/catshare.js'
// @ts-ignore
import * as NI from '../../js/notincome.js'
// @ts-ignore
import * as Bulk from '../../js/bulk.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import { monthRecap } from '../../js/recap.js'
// @ts-ignore
import { everydaySpent } from '../../js/safespend.js'
// @ts-ignore
import { monthFlows, savingsRates } from '../../js/longview.js'
// @ts-ignore
import { weeklyReview } from '../../js/review.js'
// @ts-ignore
import { matchingIncome, salaryConfig } from '../../js/salary.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 100000
  return { id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: n, updatedAt: n, ...over }
}
const money = (list: any[]) => {
  const s = M.normalizeState({
    settings: {
      currency: 'MDL',
      accounts: [
        { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 0 },
        { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 5000000 },
        { id: 'euro', name: 'Cash EURO', kind: 'cash', currency: 'EUR', start: 0 }
      ]
    },
    tx: list,
    rates: { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: 1 }
  })
  return s
}
const TODAY = '2026-11-16'
// Real pay (1 000 000 bani = 10 000 MDL), 4 000 spent, then three "Other income" records on 14 Nov:
// 1 430 EUR into Cash EURO (valued at 20 MDL = 28 600 MDL), 3 200 MDL and 1 200 MDL.
const base = () => [
  tx({ id: 'pay', type: 'income', category: 'work', amount: 1000000, date: '2026-11-03', note: 'Client pay' }),
  tx({ id: 'food1', amount: 400000, date: '2026-11-04' }),
  tx({ id: 'o1', type: 'income', category: 'other-in', amount: 143000, currency: 'EUR', rate: 20, base: 2860000, date: '2026-11-14', account: 'euro' }),
  tx({ id: 'o2', type: 'income', category: 'other-in', amount: 320000, date: '2026-11-14', account: 'wallet' }),
  tx({ id: 'o3', type: 'income', category: 'other-in', amount: 120000, date: '2026-11-14', account: 'card' })
]
const mark = (s: any, ids: string[]) => { for (const id of ids) s.tx.find((t: any) => t.id === id).notIncome = true }
const OTHER = 2860000 + 320000 + 120000

describe('notIncome is left out of income', () => {
  it('Earned drops by the records value in MDL and the saved share recomputes; balances stay', () => {
    const s = money(base())
    const a = M.monthSummary(s, '2026-11')
    expect(a.income).toBe(1000000 + OTHER)
    const balBefore = JSON.stringify(M.accountBalances(s))
    const totalBefore = M.totalBalance(s).total
    mark(s, ['o1', 'o2', 'o3'])
    const b = M.monthSummary(s, '2026-11')
    expect(b.income).toBe(1000000)
    expect(b.income).toBe(a.income - OTHER)
    expect(b.expense).toBe(400000)
    expect(b.net).toBe(600000)
    expect(b.savingsRate).toBeCloseTo(0.6)
    expect(JSON.stringify(M.accountBalances(s))).toBe(balBefore)
    expect(M.totalBalance(s).total).toBe(totalBefore)
    expect(M.personalMonth(s, '2026-11').personalIncome).toBe(1000000)
    expect(b.bySource.find((r: any) => r.id === 'other-in')).toBeUndefined()
  })

  it('reports, month recap, the long view and the weekly review leave them out', () => {
    const s = money(base())
    mark(s, ['o1', 'o2', 'o3'])
    const rep = M.report(s, '2026-11-01', '2026-11-30')
    expect(rep.income).toBe(1000000)
    expect(rep.savingsRate).toBeCloseTo(0.6)
    expect(M.reportSeries(s, '2026-11-01', '2026-11-30').rows.reduce((x: number, r: any) => x + r.income, 0)).toBe(1000000)
    expect(monthRecap(s, '2026-11').income).toBe(1000000)
    expect(monthFlows(s, { from: '2026-11-01', to: '2026-11-30' }).get('2026-11').income).toBe(1000000)
    const rate = savingsRates(s, TODAY).months.find((m: any) => m.key === '2026-11')
    expect(rate.income).toBe(1000000)
    expect(rate.rate).toBeCloseTo(0.6)
    expect(weeklyReview(s, TODAY).income).toBe(0)
  })

  it('salary watch does not match a marked record', () => {
    const s = money([tx({ id: 'x', type: 'income', category: 'other-in', amount: 1000000, date: '2026-11-10' })])
    s.settings.salary = { amount: 1000000, currency: 'MDL', day: 10, account: '' }
    const cfg = salaryConfig(s)
    expect(matchingIncome(s, cfg, '2026-11-10', TODAY).length).toBe(1)
    mark(s, ['x'])
    expect(matchingIncome(s, cfg, '2026-11-10', TODAY).length).toBe(0)
  })

  it('the predicates, and only income can be notIncome', () => {
    const inc = tx({ type: 'income', notIncome: true })
    const exp = tx({ type: 'expense', notIncome: true })
    expect([isNotCounted(inc), countsAsIncome(inc)]).toEqual([true, false])
    expect([isNotCounted(exp), countsAsSpending(exp)]).toEqual([false, true])
  })
})

describe('notSpending is left out of spending', () => {
  const list = () => [tx({ id: 'inc', type: 'income', category: 'work', amount: 1000000, date: '2026-11-02' }), tx({ id: 'e1', amount: 50000, date: '2026-11-15' }), tx({ id: 'e2', amount: 200000, date: '2026-11-15', category: 'other' })]
  // (left out here: needs Life System code)

  // (left out here: needs Life System code)

  // (left out here: needs Life System code)
})

describe('bulk toggle, undo and the suggestion', () => {
  it('bulk no/yes with Undo, only on the right type, one step', () => {
    const s = money(base())
    const h = createHistory()
    h.reset(s)
    expect(Bulk.countApplicable(s, ['o1', 'o2', 'food1'], 'income', 'no')).toBe(2)
    const r = Bulk.applyBulk(s, ['o1', 'o2', 'food1'], 'income', 'no')
    expect(r).toEqual({ changed: 2, skipped: 1 })
    h.record(s)
    expect(M.monthSummary(s, '2026-11').income).toBe(1000000 + 120000)
    const back = Bulk.applyBulk(s, ['o1'], 'income', 'yes')
    expect(back.changed).toBe(1)
    expect(M.monthSummary(s, '2026-11').income).toBe(1000000 + 2860000 + 120000)
    h.undo(s)
    expect(s.tx.find((t: any) => t.id === 'o1').notIncome).toBeUndefined()
    h.undo(s)
    expect(M.monthSummary(s, '2026-11').income).toBe(1000000 + OTHER)
    expect(s.tx.some((t: any) => t.notIncome)).toBe(false)
  })

  it('bulk spending works on expenses and skips loans and refunds', () => {
    const s = money([...base(), tx({ id: 'l', loan: true, amount: 1000 }), tx({ id: 'f2', amount: 5000 })])
    expect(Bulk.applyBulk(s, ['food1', 'l', 'f2', 'o1'], 'spending', 'no')).toEqual({ changed: 2, skipped: 2 })
    expect(M.monthSummary(s, '2026-11').expense).toBe(0)
  })

  it('suggests Other income records with no note, never changes them, and answers stick', () => {
    const s = money([...base(), tx({ id: 'n1', type: 'income', category: 'other-in', amount: 5000, note: 'Gift from a friend' })])
    const ids = () => NI.notIncomeSuggestions(s).map((t: any) => t.id).sort()
    expect(ids()).toEqual(['o1', 'o2', 'o3'])
    expect(s.tx.some((t: any) => t.notIncome)).toBe(false)
    expect(NI.markNotIncome(s.tx.find((t: any) => t.id === 'o1'))).toBe(true)
    NI.dismissNotIncome(s.tx.find((t: any) => t.id === 'o2'))
    expect(ids()).toEqual(['o3'])
    expect(NI.markNotIncome(s.tx.find((t: any) => t.id === 'food1'))).toBe(false)
  })

  it('a record edited in the form keeps or clears the flag (FORM_FIELDS)', () => {
    const kept = M.keptOnEdit({ notIncome: true, source: 'bot' }, { type: 'income' })
    expect(kept.notIncome).toBeUndefined()
    expect(kept.source).toBe('bot')
  })
})
