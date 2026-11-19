// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyBatch1.test.ts) by scripts/port-mega-tests.mjs. 2 test(s) that need Life System code (./moneyHub) are left out.
// Money batch 1: refunds that lower spending, a clear goal reservations warning,
// the date of the exchange rate with a stale warning, and the duplicate finder.
// Made-up data only; the clock is always passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { categoryShares, spendRange, countsAsIncome, countsAsSpending, isRefund } from '../../js/catshare.js'
// @ts-ignore
import * as Refunds from '../../js/refunds.js'
// @ts-ignore
import * as Dupes from '../../js/dupes.js'
// @ts-ignore
import { rateStatus, rateDate, rateFromText } from '../../js/ratedate.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import { monthRecap } from '../../js/recap.js'
// @ts-ignore
import { everydaySpent } from '../../js/safespend.js'
// @ts-ignore
import { monthFlows } from '../../js/longview.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 100000
  return { id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: n, updatedAt: n, ...over }
}
const money = (list: any[], extra: any = {}) => {
  const s = M.normalizeState({
    settings: {
      currency: 'MDL',
      accounts: [
        { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 0 },
        { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 5000000 }
      ],
      ...extra.settings
    },
    tx: list,
    rates: { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: 1 },
    ...extra.state
  })
  s.settings.categories.push({ id: 'tech', type: 'expense', name: 'Tech', emoji: '💻', jar: 'living', updatedAt: 1 })
  return s
}
const TODAY = '2026-11-13'

describe('refunds lower spending, they are not income', () => {
  const base = () => [tx({ category: 'tech', amount: 100000, date: '2026-11-10', note: 'Headphones' })]
  const refund = (over: any = {}) => tx({ type: 'income', refund: true, category: 'tech', amount: 30000, date: '2026-11-11', note: 'Refund headphones', ...over })

  // (left out here: needs Life System code)

  it('balances and net worth do not change: the money did come in', () => {
    const s = money([...base(), refund()])
    const none = money(base())
    expect(M.accountBalances(s).card).toBe(M.accountBalances(none).card + 30000)
  })

  it('budgets use the refund too, and a category cannot show below 0 in the donut', () => {
    const s = money([...base(), refund({ amount: 150000 })])
    s.settings.categories.find((c: any) => c.id === 'tech').budget = 200000
    const row = M.budgetStatus(s, '2026-11', TODAY).rows.find((r: any) => r.category.id === 'tech')
    expect(row.spent).toBe(-50000) // the math keeps the sign
    const s2 = money([...base(), refund({ amount: 150000 }), tx({ category: 'food', amount: 20000 })])
    const shares = categoryShares(s2.tx, spendRange('month', TODAY), M.B)
    expect(shares.rows.map((r: any) => r.id)).toEqual(['food']) // Tech is shown as nothing
    expect(shares.rows[0].pct).toBe(100)
    expect(shares.total).toBe(20000 + 100000 - 150000)
    const rep = M.report(s2, '2026-11-01', '2026-11-30')
    expect(rep.spending.rows.map((r: any) => r.id)).toEqual(['food'])
  })

  it('only income with refund: true is a refund; loans and adjustments never are', () => {
    expect(isRefund(refund())).toBe(true)
    expect(isRefund({ ...refund(), loan: true })).toBe(false)
    expect(isRefund({ ...refund(), reconcile: 'x' })).toBe(false)
    expect(isRefund(tx())).toBe(false)
    expect(countsAsIncome(refund())).toBe(false)
    expect(countsAsSpending(refund())).toBe(true)
  })

  it('Undo puts a marked refund back as it was', () => {
    const s = money([...base(), tx({ type: 'income', category: 'other-in', amount: 30000, date: '2026-11-06', note: 'Refund headphones', id: 'r1' })])
    const h = createHistory()
    h.reset(s)
    const before = M.monthSummary(s, '2026-11')
    expect(before.income).toBe(30000)
    expect(Refunds.markRefund(s, s.tx.find((t: any) => t.id === 'r1'), 'tech')).toBe(true)
    h.record(s)
    const after = M.monthSummary(s, '2026-11')
    expect([after.income, after.expense]).toEqual([0, 70000])
    h.undo(s)
    const undone = M.monthSummary(s, '2026-11')
    expect([undone.income, undone.expense]).toEqual([30000, 100000])
    expect(s.tx.find((t: any) => t.id === 'r1').refund).toBeUndefined()
  })

  it('suggests income that looks like a refund, never changes it by itself', () => {
    const list = [
      tx({ type: 'income', category: 'other-in', amount: 30000, note: 'Return Zara', id: 'a' }),
      tx({ type: 'income', category: 'other-in', amount: 9000, note: 'Rambursare taxi', id: 'b' }),
      tx({ type: 'income', category: 'work', amount: 500000, note: 'Salary', id: 'c' }),
      tx({ type: 'income', category: 'other-in', amount: 100, note: 'refund no thanks', id: 'd', refundNo: true }),
      tx({ category: 'clothes', amount: 30000, note: 'Zara', date: '2026-10-30', id: 'e' })
    ]
    const s = money(list)
    const snapshot = JSON.stringify(s.tx)
    const found = Refunds.refundSuggestions(s)
    expect(found.map((t: any) => t.id).sort()).toEqual(['a', 'b'])
    expect(JSON.stringify(s.tx)).toBe(snapshot)
    // the category guess follows the shop
    expect(Refunds.guessRefundCategory(s, found.find((t: any) => t.id === 'a'))).toBe('clothes')
    expect(Refunds.guessRefundCategory(s, found.find((t: any) => t.id === 'b'))).toBe('other')
    // an income category can not be used for a refund
    expect(Refunds.markRefund(s, s.tx.find((t: any) => t.id === 'a'), 'work')).toBe(false)
  })

  // (left out here: needs Life System code)
})

describe('goals: a clear reservations warning', () => {
  // 40 000 MDL of cash and bank, reservations ask for 50 000.
  const state = () => {
    const s = money([], { settings: { accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 4000000 }] } })
    s.goals = [
      { id: 'g1', name: 'Trip', emoji: '🧳', target: 9000000, account: 'allocated', updatedAt: 1 },
      { id: 'g2', name: 'Laptop', emoji: '💻', target: 9000000, account: 'allocated', updatedAt: 1 }
    ]
    s.goalAllocations = [
      { id: 'ga1', goalId: 'g1', amount: 3000000, currency: 'MDL', date: '2026-11-01', createdAt: 1, updatedAt: 1 },
      { id: 'ga2', goalId: 'g2', amount: 2000000, currency: 'MDL', date: '2026-11-02', createdAt: 2, updatedAt: 2 }
    ]
    return s
  }

  it('names the goal that is short, by how much, and why', () => {
    const f = M.goalShortfalls(state())
    expect(f.cashShort).toBe(true)
    expect(f.cash).toBe(4000000)
    expect(f.requested).toBe(5000000)
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0]).toMatchObject({ goalId: 'g2', name: 'Laptop', short: 1000000, lowerTo: 1000000 })
  })

  it('"Lower to" cuts the reservation to what can be funded, keeps it, and Undo restores it', () => {
    const s = state()
    const h = createHistory()
    h.reset(s)
    expect(M.lowerGoalReservations(s, 'g2')).toBe(1)
    h.record(s)
    expect(s.goalAllocations.find((a: any) => a.id === 'ga2').amount).toBe(1000000)
    expect(s.goalAllocations).toHaveLength(2) // nothing was released
    expect(M.goalAllocationSummary(s).unfunded).toBe(0)
    expect(M.goalShortfalls(s).rows).toEqual([])
    h.undo(s)
    expect(s.goalAllocations.find((a: any) => a.id === 'ga2').amount).toBe(2000000)
  })

  it('a reservation with nothing funded is not lowered (that would release it)', () => {
    const s = state()
    s.goalAllocations.push({ id: 'ga3', goalId: 'g2', amount: 500000, currency: 'MDL', date: '2026-11-03', createdAt: 3, updatedAt: 3 })
    expect(M.lowerGoalReservations(s, 'g2')).toBe(1)
    expect(s.goalAllocations.find((a: any) => a.id === 'ga3').amount).toBe(500000)
    expect(M.goalShortfalls(s).rows[0].lowerable).toEqual([])
  })

  it('no warning when everything can be funded', () => {
    const s = state()
    s.goalAllocations = s.goalAllocations.slice(0, 1)
    expect(M.goalShortfalls(s).rows).toEqual([])
  })
})

describe('exchange rate date and stale warning', () => {
  const rates = (date: string | null, extra: any = {}) => ({ usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, sources: date ? { fiat: { name: 'x', date } } : {}, ...extra })

  it('takes the newest date a source gave', () => {
    expect(rateDate(rates('2026-11-10', { sources: { fiat: { date: '2026-11-10' }, mdl: { date: '2026-11-12' } } }))).toBe('2026-11-12')
    expect(rateFromText('2026-11-12')).toBe('rate from 12 Nov')
  })

  it('is stale only when older than 3 days (fixed clock)', () => {
    expect(rateStatus(rates('2026-11-13'), TODAY)).toMatchObject({ days: 0, stale: false })
    expect(rateStatus(rates('2026-11-10'), TODAY)).toMatchObject({ days: 3, stale: false })
    expect(rateStatus(rates('2026-11-09'), TODAY)).toMatchObject({ days: 4, stale: true })
    expect(rateStatus(rates('2026-10-01'), TODAY).stale).toBe(true)
  })

  it('falls back to the day it was downloaded, and says nothing without rates', () => {
    const at = new Date(2026, 10, 7, 12).getTime()
    expect(rateStatus(rates(null, { fetchedAt: at }), TODAY)).toMatchObject({ date: '2026-11-07', stale: true })
    expect(rateStatus({}, TODAY)).toMatchObject({ none: true, stale: false })
    expect(rateStatus(undefined, TODAY).none).toBe(true)
  })
})

describe('duplicate finder', () => {
  const pair = () => [
    tx({ id: 'a1', amount: 4500, note: 'Lunch at Andys', date: '2026-11-05', createdAt: 1 }),
    tx({ id: 'a2', amount: 4500, note: 'lunch andys', date: '2026-11-06', createdAt: 2 })
  ]

  it('finds a seeded pair, skips different amounts, accounts, types and days further apart', () => {
    const s = money([
      ...pair(),
      tx({ id: 'b1', amount: 4600, note: 'Lunch at Andys', date: '2026-11-05' }), // other amount
      tx({ id: 'b2', amount: 4500, note: 'Lunch at Andys', date: '2026-11-05', account: 'wallet' }), // other account
      tx({ id: 'b3', amount: 4500, note: 'Lunch at Andys', date: '2026-11-09' }), // 3 days later
      tx({ id: 'b4', amount: 4500, note: 'Salary', type: 'income', category: 'work', date: '2026-11-05' }), // other type
      tx({ id: 'b5', amount: 4500, note: 'Bus ticket', date: '2026-11-05' }) // other note
    ])
    const g = Dupes.findDuplicates(s)
    expect(g).toHaveLength(1)
    expect(g[0].records.map((r: any) => r.id)).toEqual(['a1', 'a2'])
    expect(g[0].keep).toBe('a1')
  })

  it('removes the others in one batch and Undo brings them all back; balances follow', () => {
    const s = money([...pair(), tx({ id: 'c1', amount: 900, note: 'Coffee', date: '2026-11-07' }), tx({ id: 'c2', amount: 900, note: 'Coffee', date: '2026-11-07' })])
    const bal0 = M.accountBalances(s).card
    const h = createHistory()
    h.reset(s)
    const groups = Dupes.findDuplicates(s)
    expect(groups).toHaveLength(2)
    const gone = Dupes.removeDuplicates(s, groups.map((g: any) => ({ keep: g.keep, ids: g.records.map((r: any) => r.id) })))
    h.record(s)
    expect(gone).toHaveLength(2)
    expect(s.tx).toHaveLength(2)
    expect(M.accountBalances(s).card).toBe(bal0 + 4500 + 900)
    expect(Dupes.findDuplicates(s)).toEqual([])
    h.undo(s)
    expect(s.tx).toHaveLength(4)
    expect(M.accountBalances(s).card).toBe(bal0)
  })

  it('can keep the second one instead', () => {
    const s = money(pair())
    const [g] = Dupes.findDuplicates(s)
    Dupes.removeDuplicates(s, [{ keep: 'a2', ids: g.records.map((r: any) => r.id) }])
    expect(s.tx.map((t: any) => t.id)).toEqual(['a2'])
  })

  it('skips records marked "not a duplicate", and split receipt parts', () => {
    const s = money(pair())
    expect(Dupes.findDuplicates(s)).toHaveLength(1)
    expect(Dupes.markNotDuplicate(s, ['a1', 'a2'])).toBe(2)
    expect(Dupes.findDuplicates(s)).toEqual([])
    const parts = money([tx({ id: 'p1', amount: 500, note: 'Receipt', splitOf: 'r' }), tx({ id: 'p2', amount: 500, note: 'Receipt', splitOf: 'r' })])
    expect(Dupes.findDuplicates(parts)).toEqual([])
  })

  it('keeps the record that carries more (a receipt, a tag) when you do not choose', () => {
    const s = money([
      tx({ id: 'd1', amount: 700, note: 'Pharmacy', date: '2026-11-05', createdAt: 1 }),
      tx({ id: 'd2', amount: 700, note: 'Pharmacy', date: '2026-11-05', createdAt: 2, receipts: ['r-1'], tax: 'deductible' })
    ])
    expect(Dupes.findDuplicates(s)[0].keep).toBe('d2')
  })

  it('asks Life System for a backup first, and stands down when it fails', async () => {
    const sent: any[] = []
    const listeners: any[] = []
    const win: any = {
      parent: { postMessage: (m: any) => { sent.push(m); setTimeout(() => listeners.forEach((l) => l({ origin: 'http://x', data: { type: 'LIFE_BACKUP_DONE', id: m.payload.id, ok: false, error: 'No space' } })), 0) } },
      location: { origin: 'http://x' },
      addEventListener: (_: string, f: any) => listeners.push(f),
      removeEventListener: (_: string, f: any) => listeners.splice(listeners.indexOf(f), 1)
    }
    const r = await Dupes.backupBefore('removing 1 duplicate', { win, timeout: 500 })
    expect(sent[0]).toMatchObject({ type: 'LIFE_SYSTEM_BRIDGE', action: 'BACKUP_BEFORE' })
    expect(r).toEqual({ ok: false, error: 'No space' })
    // standalone (no parent): nothing to ask, Undo is the safety net
    const alone: any = { addEventListener() {}, removeEventListener() {} }
    alone.parent = alone
    expect((await Dupes.backupBefore('x', { win: alone })).ok).toBe(true)
  })
})
