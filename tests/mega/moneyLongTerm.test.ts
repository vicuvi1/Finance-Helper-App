// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyLongTerm.test.ts) by scripts/port-mega-tests.mjs. 2 test(s) that need Life System code (@core/budgetNotice, @core/checkupNotice, ../money/checkupRunner, @core/notifyBudget) are left out.
// Money for long-term use (2026-11-18): repeating records, the monthly check-up, more budget kinds and the
// year summary. Made-up data; the clock is pinned.
import { afterEach, beforeEach, describe, expect, it, vi } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as R from '../../js/recurring.js'
// @ts-ignore
import * as C from '../../js/checkup.js'
// @ts-ignore
import * as Bd from '../../js/budgets.js'
// @ts-ignore
import { yearSummary } from '../../js/yearsummary.js'
// @ts-ignore
import { budgetCrossings, newWarnings } from '../../js/budgetwarn.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'

let n = 0
const tx = (amount: number, over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: 1, updatedAt: 1, ...over })
const mk = (list: any[] = [], extra: any = {}) =>
  M.normalizeState({
    settings: { currency: 'MDL', accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 100000 }, { id: 'eur', name: 'Euro', kind: 'card', currency: 'EUR', start: 0 }], ...extra.settings },
    tx: list,
    recurring: extra.recurring || [],
  })
const rule = (over: any = {}) => ({ id: 'r1', type: 'expense', amount: 500000, currency: 'MDL', account: 'card', category: 'home', note: 'Rent', every: 'month', start: '2026-01-31', lastDone: null, auto: false, paused: false, updatedAt: 1, ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T12:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('repeating records: dates', () => {
  const dates = (r: any, to = '2028-12-31', from = r.start) => R.occurrences(r, from, to)
  it('a monthly rule on the 31st lands on the last day of shorter months and comes back to the 31st', () => {
    expect(dates(rule(), '2026-06-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
  })
  it('leap years: 29 Feb yearly is 28 Feb in common years and 29 Feb again in 2028', () => {
    expect(dates(rule({ every: 'year', start: '2024-02-29' }), '2028-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
    expect(dates(rule({ start: '2027-12-31' }), '2028-03-31')).toEqual(['2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31'])
  })
  it('custom: every N days, weeks, months and years', () => {
    expect(dates(rule({ every: 'custom', n: 10, unit: 'day', start: '2026-02-20' }), '2026-03-12')).toEqual(['2026-02-20', '2026-03-02', '2026-03-12'])
    expect(dates(rule({ every: 'custom', n: 3, unit: 'week', start: '2026-11-02' }), '2027-01-15')).toEqual(['2026-11-02', '2026-11-23', '2026-12-14', '2027-01-04'])
    expect(dates(rule({ every: 'custom', n: 2, unit: 'month', start: '2026-11-30' }), '2027-05-31')).toEqual(['2026-11-30', '2027-01-30', '2027-03-30', '2027-05-30'])
    expect(dates(rule({ every: 'custom', n: 2, unit: 'year', start: '2026-05-10' }), '2031-01-01')).toEqual(['2026-05-10', '2028-05-10', '2030-05-10'])
  })
  it('a day of the month: the first such day on or after the start, short months use the last day', () => {
    const r = rule({ every: 'custom', n: 1, unit: 'month', dom: 30, start: '2026-01-15' })
    expect(dates(r, '2026-04-30')).toEqual(['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30'])
    expect(dates(rule({ every: 'custom', n: 1, unit: 'month', dom: 5, start: '2026-01-15' }), '2026-03-31')).toEqual(['2026-02-05', '2026-03-05'])
  })
  it('the old ids still work and end dates stop a rule', () => {
    expect(dates(rule({ every: '3months', start: '2026-11-15' }), '2027-06-01')).toEqual(['2026-11-15', '2027-02-15', '2027-05-15'])
    expect(dates(rule({ every: 'week', start: '2026-11-01', end: '2026-11-15' }))).toEqual(['2026-11-01', '2026-11-08', '2026-11-15'])
    expect(R.describe(rule({ every: 'custom', n: 2, unit: 'week' }))).toBe('Every 2 weeks')
    expect(R.describe(rule({ every: 'custom', n: 1, unit: 'month', dom: 1 }))).toBe('Every month on the 1st')
    expect(R.perMonth(rule({ every: 'custom', n: 2, unit: 'month', amount: 1000 }))).toBe(500)
  })
})

describe('repeating records: due, idempotent across devices', () => {
  it('a monthly rent rule is due on its day, once per date', () => {
    const r = rule({ start: '2026-11-18', note: 'Rent' })
    const s = mk([], { recurring: [r] })
    expect(R.dueItems(s, '2026-11-17')).toEqual([])
    expect(R.dueItems(s, '2026-11-18').map((x: any) => x.date)).toEqual(['2026-11-18'])
  })
  it('a date another device already logged is never offered again, even with a stale lastDone', () => {
    const r = rule({ start: '2026-10-18' })
    const s = mk([], { recurring: [r] })
    const first = R.dueItems(s, '2026-11-18').map((x: any) => x.date)
    expect(first).toEqual(['2026-10-18', '2026-11-18'])
    // Device B logged October (same deterministic id) and this device syncs it in.
    s.tx.push(R.makeTx(r, '2026-10-18', { id: R.recId(r, '2026-10-18') }))
    expect(R.dueItems(s, '2026-11-18').map((x: any) => x.date)).toEqual(['2026-11-18'])
  })
  it('both devices adding the same date merge to one record', () => {
    const r = rule({ start: '2026-11-18' })
    const a = mk([R.makeTx(r, '2026-11-18', { id: R.recId(r, '2026-11-18'), now: 10 })], { recurring: [{ ...r, lastDone: '2026-11-18', updatedAt: 10 }] })
    const b = mk([R.makeTx(r, '2026-11-18', { id: R.recId(r, '2026-11-18'), now: 20 })], { recurring: [{ ...r, lastDone: '2026-11-18', updatedAt: 20 }] })
    const out = mergeStates(a, toCloud(b, 'b'))
    expect(out.state.tx.filter((t: any) => t.recurring === 'r1').length).toBe(1)
    // Week, year and trip budgets and check-up dates merge too.
    a.settings.budgets = [{ id: 'b1', name: 'A', period: 'week', limit: 1, updatedAt: 5 }]
    b.settings.budgets = [{ id: 'b2', name: 'B', period: 'week', limit: 1, updatedAt: 6 }]
    a.settings.checkupLast = { card: '2026-11-02' }
    b.settings.checkupLast = { card: '2026-11-01', eur: '2026-11-03' }
    const m2 = mergeStates(a, toCloud(b, 'b')).state.settings
    expect(m2.budgets.map((x: any) => x.id).sort()).toEqual(['b1', 'b2'])
    expect(m2.checkupLast).toEqual({ card: '2026-11-02', eur: '2026-11-03' })
  })
})

describe('monthly check-up', () => {
  it('monthly: due from the chosen day until every account is checked for this month; off or snoozed is quiet', () => {
    const s = mk([], { settings: { checkupEvery: 'month' } })
    expect(C.checkupDue(s, '2026-11-18')).toMatchObject({ month: '2026-11', cycle: '2026-11-01' })
    expect(C.checkupDue(s, '2026-11-18').left.length).toBe(s.settings.accounts.length)
    for (const a of s.settings.accounts) C.applyCheckup(s, a.id, null, '2026-11-18')
    expect(C.checkupDue(s, '2026-11-25')).toBeNull()
    expect(C.checkupDue(s, '2026-12-01')).not.toBeNull()
    s.settings.checkupDay = 20
    expect(C.checkupDue(s, '2026-12-01')).toBeNull()
    expect(C.checkupDue(s, '2026-12-20')).not.toBeNull()
    s.settings.checkupDay = 1
    s.settings.checkupOn = false
    expect(C.checkupDue(s, '2026-12-01')).toBeNull()
    s.settings.checkupOn = true
    C.snoozeCheckup(s, '2026-12-01')
    expect(C.checkupCard(s, '2026-12-01')).toBeNull()
    expect(C.checkupCard(s, '2026-12-02')).not.toBeNull()
  })
  it('"Yes" adds no record, only the date', () => {
    const s = mk()
    const r = C.applyCheckup(s, 'card', null, '2026-11-18')
    expect(r.tx).toBeNull()
    expect(s.tx.length).toBe(0)
    expect(s.settings.checkupLast.card).toBe('2026-11-18')
  })
  it('a real balance below the app adds one expense marked notSpending; above adds income marked notIncome; balances match the bank', () => {
    const s = mk([tx(20000, { date: '2026-11-02' })]) // card: 1000.00 - 200.00 = 800.00
    const down = C.applyCheckup(s, 'card', 75000, '2026-11-18')
    expect(down).toMatchObject({ expected: 80000, diff: -5000 })
    expect(down.tx).toMatchObject({ type: 'expense', amount: 5000, notSpending: true, checkup: true, note: 'Monthly check-up', date: '2026-11-18' })
    expect(M.accountBalances(s).card).toBe(75000)
    const up = C.applyCheckup(s, 'card', 90000, '2026-11-19')
    expect(up.tx).toMatchObject({ type: 'income', amount: 15000, notIncome: true })
    expect(M.accountBalances(s).card).toBe(90000)
    // Totals stay honest: neither adjustment is income or spending.
    const rep = M.report(s, '2026-11-01', '2026-11-30')
    expect(rep.expense).toBe(20000)
    expect(rep.income).toBe(0)
  })
  it('a foreign account: the adjustment is valued in the main currency at the given rate', () => {
    const s = mk([tx(1000, { account: 'eur', currency: 'EUR', type: 'income', rate: 20, base: 20000, category: 'work' })])
    const r = C.applyCheckup(s, 'eur', 800, '2026-11-18', { rate: 20 })
    expect(r.tx).toMatchObject({ type: 'expense', amount: 200, currency: 'EUR', rate: 20, base: 4000, notSpending: true })
  })
  // (left out here: needs Life System code)
})

describe('more budget kinds', () => {
  const bud = (over: any) => ({ id: 'b1', name: 'Budget', period: 'month', limit: 100000, cats: [], tags: [], updatedAt: 1, ...over })
  it('weekly: Monday to Sunday of this week only', () => {
    // 18 Nov 2026 is a Wednesday: the week is 16-22 Nov.
    const s = mk([tx(30000, { date: '2026-11-16' }), tx(20000, { date: '2026-11-22' }), tx(99999, { date: '2026-11-15' }), tx(99999, { date: '2026-11-23' })])
    const p = Bd.budgetProgress(s, bud({ period: 'week', limit: 100000 }), '2026-11-18')
    expect(p).toMatchObject({ from: '2026-11-16', to: '2026-11-22', spent: 50000, level: 'ok' })
  })
  it('yearly counts the calendar year, refunds lower it, not-spending and loans never count', () => {
    const s = mk([tx(60000, { date: '2026-01-02' }), tx(10000, { type: 'income', refund: true, date: '2026-06-01' }), tx(500000, { notSpending: true }), tx(500000, { loan: true }), tx(70000, { date: '2025-12-31' })])
    const p = Bd.budgetProgress(s, bud({ period: 'year', limit: 50000 }), '2026-11-18')
    expect(p.spent).toBe(50000)
    expect(p.level).toBe('over')
  })
  it('a trip budget tracks only its dates and its tags / categories', () => {
    const s = mk([
      tx(40000, { date: '2026-11-10', note: 'flight #rome' }),
      tx(30000, { date: '2026-11-12', note: 'dinner #Rome' }),
      tx(90000, { date: '2026-11-12', note: 'groceries' }), // not tagged
      tx(90000, { date: '2026-11-20', note: 'museum #rome' }), // after the trip
      tx(90000, { date: '2026-11-08', note: 'bus #rome' }), // before
      tx(10000, { date: '2026-11-11', note: 'gift', category: 'fun' }),
    ])
    const trip = bud({ period: 'range', from: '2026-11-09', to: '2026-11-15', limit: 100000, tags: ['rome'] })
    expect(Bd.budgetProgress(s, trip, '2026-11-18')).toMatchObject({ spent: 70000, status: 'ended' })
    const cat = bud({ period: 'range', from: '2026-11-09', to: '2026-11-15', cats: ['fun'] })
    expect(Bd.budgetProgress(s, cat, '2026-11-12').spent).toBe(10000)
    expect(Bd.budgetProgress(s, { ...trip, from: '2026-11-17', to: '2026-11-25' }, '2026-11-12').status).toBe('soon')
  })
  it('makeBudget checks the form; saving keeps monthly category budgets untouched', () => {
    expect(Bd.makeBudget({ limit: 0, period: 'week', name: 'x' }).error).toMatch(/limit/)
    expect(Bd.makeBudget({ limit: 100, period: 'range', name: 'Trip', from: '2026-11-10', to: '2026-11-01' }).error).toMatch(/last day/)
    expect(Bd.makeBudget({ limit: 100, period: 'week' }).error).toMatch(/name/)
    const s = mk()
    s.settings.categories.find((c: any) => c.id === 'food').budget = 200000
    const r = Bd.makeBudget({ limit: 100000, period: 'range', name: 'Rome', from: '2026-11-09', to: '2026-11-15', tags: ['#Rome'] })
    Bd.saveBudget(s, r.budget)
    expect(Bd.budgetsOf(s).length).toBe(1)
    expect(Bd.budgetsOf(s)[0].tags).toEqual(['rome'])
    expect(s.settings.categories.find((c: any) => c.id === 'food').budget).toBe(200000)
    Bd.removeBudget(s, r.budget.id)
    expect(Bd.budgetsOf(s)).toEqual([])
  })
  // (left out here: needs Life System code)
})

describe('year summary', () => {
  const rates = { usd: { MDL: 17.5, EUR: 0.9 }, fetchedAt: Date.parse('2026-11-01T00:00:00Z') }
  const data = () => {
    const inc = (amount: number, date: string, over: any = {}) => tx(amount, { type: 'income', category: 'work', date, ...over })
    return mk([
      inc(1000000, '2026-01-10'),
      inc(1000000, '2026-02-10'),
      inc(100000, '2026-02-12', { notIncome: true }), // not income
      inc(10000, '2026-03-01', { currency: 'EUR', rate: 20, base: 200000 }), // 100.00 EUR valued at 2000.00 MDL
      tx(300000, { date: '2026-01-15', category: 'home' }),
      tx(200000, { date: '2026-02-15', category: 'food' }),
      tx(50000, { date: '2026-02-16', category: 'food', notSpending: true }), // not spending
      tx(40000, { date: '2026-03-05', category: 'food', currency: 'EUR', rate: 20, base: 40000 }),
      { ...tx(10000, { date: '2026-03-06', category: 'food' }), type: 'income', refund: true }, // refund lowers food
      tx(100000, { date: '2026-03-07', category: 'fun', loan: true }), // loan: neither
      tx(250000, { date: '2025-01-15', category: 'food' }), // last year
      tx(100000, { date: '2025-02-15', category: 'home' }),
      inc(900000, '2025-03-01'),
    ], { settings: { currency: 'MDL' } })
  }
  it('income vs spending per month, savings rate, and the same totals as the Log', () => {
    const s = data()
    const y = yearSummary(s, 2026, '2026-12-31')
    expect(y.months.map((m: any) => m.income)).toEqual([1000000, 1000000, 200000, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(y.months.map((m: any) => m.spending).slice(0, 3)).toEqual([300000, 200000, 30000])
    expect(y.income).toBe(2200000)
    expect(y.spending).toBe(530000)
    expect(y.savingsRate).toBeCloseTo((2200000 - 530000) / 2200000)
    // The Log's own report agrees.
    const rep = M.report(s, '2026-01-01', '2026-12-31')
    expect(y.income).toBe(rep.income)
    expect(y.spending).toBe(rep.expense)
  })
  it('top categories with the change from last year; biggest purchases; no refunds or not-spending in them', () => {
    const y = yearSummary(data(), 2026, '2026-12-31')
    expect(y.topCategories.map((c: any) => c.id)).toEqual(['home', 'food'])
    expect(y.topCategories[0]).toMatchObject({ amount: 300000, prev: 100000, change: 2 })
    expect(y.topCategories[1]).toMatchObject({ amount: 230000, prev: 250000 })
    expect(y.topCategories[1].change).toBeCloseTo(-0.08)
    expect(y.biggest.map((b: any) => b.amount)).toEqual([300000, 200000, 40000])
  })
  it('a year in progress runs to today and is compared with the same days last year', () => {
    const y = yearSummary(data(), 2026, '2026-02-20')
    expect(y.partial).toBe(true)
    expect(y.to).toBe('2026-02-20')
    expect(y.prevTo).toBe('2025-02-20')
    expect(y.spending).toBe(500000)
    expect(y.months[3].future).toBe(true)
  })
  it('no-spend days count the days without a spending record', () => {
    const s = mk([tx(100, { date: '2026-01-01' }), tx(100, { date: '2026-01-03' }), tx(100, { date: '2026-01-03' })])
    const y = yearSummary(s, 2026, '2026-01-10')
    expect(y.countedDays).toBe(10)
    expect(y.noSpendDays).toBe(8)
  })
  it('net worth runs from the start of the year to its end (from the long view)', () => {
    const s = data()
    s.rates = rates
    const y = yearSummary(s, 2026, '2026-12-31')
    expect(y.netWorth).not.toBeNull()
    expect(y.netWorth!.end - y.netWorth!.start).not.toBe(0)
    expect(yearSummary(s, 2030, '2026-12-31').netWorth).toBeNull()
  })
  it('income by source appears only when records carry a source', () => {
    const s = data()
    expect(yearSummary(s, 2026, '2026-12-31').sources).toBeNull()
    s.tx.find((t: any) => t.date === '2026-01-10').incomeSource = 'job'
    s.settings.incomeSources = [{ id: 'job', name: 'Day job', createdAt: 1, updatedAt: 1 }]
    const y = yearSummary(s, 2026, '2026-12-31')
    expect(y.sources.find((x: any) => x.id === 'job')).toMatchObject({ name: 'Day job', amount: 1000000 })
    expect(y.sources.find((x: any) => x.id === '')).toMatchObject({ name: 'No source', amount: 1200000 })
    expect(y.sources.reduce((a: number, x: any) => a + x.amount, 0)).toBe(y.income)
  })
})
