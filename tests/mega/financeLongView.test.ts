// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeLongView.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper's long view (js/longview.js): net worth over time with
// historical rates, the savings rate, this year against last year and the
// runway. Made-up records only; every function gets `today`, so no clock.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module
import { netWorthHistory, contributions, savingsRates, yearOverYear, runway, runwayText, monthsText, longCard, booksIn, rateBook, monthFlows, viewCurrencies } from '../../js/longview.js'
// @ts-ignore plain JS module
import { report, totalBalance } from '../../js/model.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 10000
  return { id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-01-10', category: 'food', account: 'cash', ...over }
}
const acc = (id: string, over: any = {}) => ({ id, name: id, kind: 'cash', currency: 'MDL', start: 0, holdings: [], ...over })
const cats = [
  { id: 'work', type: 'income', name: 'Work' },
  { id: 'food', type: 'expense', name: 'Food', emoji: '🍔' },
  { id: 'fun', type: 'expense', name: 'Fun' },
  { id: 'home', type: 'expense', name: 'Home' },
  { id: 'clothes', type: 'expense', name: 'Clothes' }
]
const state = (over: any = {}) => ({
  settings: { currency: 'MDL', categories: cats, accounts: [acc('cash', { start: 100000 })], ...(over.settings || {}) },
  tx: over.tx || [],
  rates: over.rates ?? null
})

describe('net worth over time', () => {
  it('rebuilds month ends from the opening balance and records; transfers between accounts change nothing', () => {
    const s = state({
      settings: { accounts: [acc('cash', { start: 100000 }), acc('safe', { kind: 'savings', start: 0 })] },
      tx: [
        tx({ type: 'income', category: 'work', amount: 500000, date: '2026-01-05' }),
        tx({ amount: 20000, date: '2026-01-20' }),
        tx({ type: 'transfer', amount: 300000, from: 'cash', to: 'safe', date: '2026-02-01', category: undefined, account: undefined }),
        tx({ amount: 30000, date: '2026-03-02' })
      ]
    })
    const h = netWorthHistory(s, '2026-03-15')
    expect(h.opening).toBe(100000)
    expect(h.months.map((m: any) => [m.key, m.total])).toEqual([
      ['2026-01', 580000],
      ['2026-02', 580000],
      ['2026-03', 550000]
    ])
    expect(h.months[1].byAccount).toEqual({ cash: 280000, safe: 300000 })
    expect(h.months.at(-1).date).toBe('2026-03-15')
    // Data started this year: the change this year is from the opening balances.
    expect(h.changeThisYear).toBe(450000)
    expect(h.years).toEqual([{ year: 2026, date: '2026-03-15', total: 550000, change: 450000 }])
    const c = contributions(h, '2026-02')
    expect(c.find((a: any) => a.id === 'safe')).toMatchObject({ value: 300000, change: 300000 })
    expect(c.find((a: any) => a.id === 'cash')).toMatchObject({ value: 280000, change: -300000 })
  })

  it('keeps empty months as points and makes one row per year with its change', () => {
    const s = state({ tx: [tx({ amount: 10000, date: '2025-11-03' }), tx({ type: 'income', category: 'work', amount: 50000, date: '2026-02-01' })] })
    const h = netWorthHistory(s, '2026-02-10')
    expect(h.months.map((m: any) => m.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(h.months.map((m: any) => m.total)).toEqual([90000, 90000, 90000, 140000])
    expect(h.years).toEqual([
      { year: 2025, date: '2025-12-31', total: 90000, change: -10000 },
      { year: 2026, date: '2026-02-10', total: 140000, change: 50000 }
    ])
    expect(h.changeThisYear).toBe(50000)
  })

  it('converts other currencies with the saved rate of each month end, not today', () => {
    // Rates are units per 1 USD: MDL 18 / EUR 0.9 = 20 MDL per EUR in January; 22 in February; today 25.
    const s = state({
      settings: { accounts: [acc('cash', { start: 0 }), acc('eur', { currency: 'EUR', start: 10000 })] },
      tx: [tx({ type: 'income', category: 'work', account: 'eur', currency: 'EUR', amount: 10000, rate: 20, base: 200000, date: '2026-01-15' })],
      rates: { usd: { USD: 1, MDL: 25, EUR: 1 }, history: { '2026-01-28': { USD: 1, MDL: 18, EUR: 0.9 }, '2026-02-27': { USD: 1, MDL: 22, EUR: 1 } } }
    })
    const h = netWorthHistory(s, '2026-03-05')
    expect(h.months.map((m: any) => m.total)).toEqual([20000 * 20, 20000 * 22, 20000 * 25])
    expect(h.months.every((m: any) => !m.estimated)).toBe(true)
  })

  it('falls back to the rate of a converted record, and never counts 1:1 without any rate', () => {
    const withRecord = state({
      settings: { accounts: [acc('usd', { currency: 'USD', start: 0 })] },
      tx: [tx({ type: 'income', category: 'work', account: 'usd', currency: 'USD', amount: 10000, rate: 17.5, base: 175000, date: '2026-01-02' })]
    })
    const a = netWorthHistory(withRecord, '2026-02-10')
    expect(a.months[0]).toMatchObject({ total: 175000, estimated: true, source: 'rebuilt' })
    // Today is totalBalance (knownRates falls back to the same record rate).
    expect(a.now).toBe(175000)
    expect(a.now).toBe(totalBalance(withRecord).total)
    const noRate = state({ settings: { accounts: [acc('cash', { start: 5000 }), acc('zzz', { currency: 'ZZZ', start: 10000 })] } })
    const b = netWorthHistory(noRate, '2026-01-31')
    expect(b.now).toBe(5000)
    expect(b.missing).toEqual(['zzz'])
    expect(rateBook(noRate)('ZZZ', '2026-01-01')).toBeNull()
  })

  it('adds coins only to today', () => {
    const s = state({
      settings: { accounts: [acc('cash', { start: 0 }), acc('btc', { kind: 'crypto', currency: 'USD', start: 0, holdings: [{ asset: 'BTC', qty: 0.01 }] })] },
      tx: [tx({ type: 'income', category: 'work', amount: 10000, date: '2026-01-02' })],
      rates: { usd: { USD: 1, MDL: 20 }, crypto: { BTC: 50000 }, history: {} }
    })
    const h = netWorthHistory(s, '2026-02-03')
    expect(h.months[0].total).toBe(10000)
    expect(h.months[1].total).toBe(10000 + 0.01 * 50000 * 100 * 20)
  })

  it('first month of data: one point, today', () => {
    const h = netWorthHistory(state({ tx: [tx({ amount: 1000, date: '2026-11-02' })] }), '2026-11-12')
    expect(h.months).toHaveLength(1)
    expect(h.months[0]).toMatchObject({ key: '2026-11', date: '2026-11-12', total: 99000 })
    const empty = netWorthHistory(state(), '2026-11-12')
    expect(empty.months.map((m: any) => m.total)).toEqual([100000])
  })
})

describe('books', () => {
  it('filters by tx.book (default personal) and the books add up to the whole', () => {
    const s = state({
      settings: { accounts: [acc('cash', { start: 100000 }), acc('biz', { start: 50000, book: 'business' })] },
      tx: [
        tx({ type: 'income', category: 'work', amount: 200000, account: 'biz', book: 'business', date: '2026-03-01' }),
        tx({ amount: 40000, account: 'biz', book: 'business', date: '2026-03-02' }),
        tx({ type: 'income', category: 'work', amount: 100000, date: '2026-03-03' }),
        tx({ amount: 20000, date: '2026-03-04' })
      ]
    })
    expect(booksIn(s)).toEqual(['personal', 'business'])
    const all = netWorthHistory(s, '2026-03-31').now
    const p = netWorthHistory(s, '2026-03-31', { book: 'personal' }).now
    const b = netWorthHistory(s, '2026-03-31', { book: 'business' }).now
    expect(p).toBe(180000)
    expect(b).toBe(210000)
    expect(p + b).toBe(all)
    expect(savingsRates(s, '2026-03-31', { book: 'business' }).months[0].rate).toBeCloseTo(0.8)
    expect(savingsRates(s, '2026-03-31', { book: 'personal' }).months[0].rate).toBeCloseTo(0.8)
  })
})

describe('savings rate', () => {
  it('(income − spending) / income with the shared rule: transfers, loans, points buys and adjustments left out; a refund is income, as in Reports', () => {
    const s = state({
      tx: [
        tx({ type: 'income', category: 'work', amount: 100000, date: '2026-04-01' }),
        tx({ amount: 30000, date: '2026-04-02' }),
        tx({ amount: 10000, date: '2026-04-03', loan: true }),
        tx({ type: 'income', category: 'work', amount: 50000, date: '2026-04-04', loan: true }),
        tx({ type: 'transfer', amount: 70000, from: 'cash', to: 'safe', date: '2026-04-05' }),
        tx({ id: 'life-reward-1', amount: 1500, date: '2026-04-06' }),
        // A reconciliation adjustment moves a balance but is neither income nor spending.
        tx({ amount: 4000, date: '2026-04-06', adjustment: true, reconcile: 'rc-1' }),
        // A refund is logged as income (there is no other kind), so it counts as income, the same as Reports.
        tx({ type: 'income', category: 'other-in', amount: 10000, date: '2026-04-07', note: 'refund for shoes' })
      ]
    })
    const f = monthFlows(s).get('2026-04')
    expect(f.income).toBe(110000)
    expect(f.spending).toBe(30000)
    const r = savingsRates(s, '2026-04-30')
    expect(r.months).toHaveLength(1)
    expect(r.months[0].rate).toBeCloseTo(80000 / 110000)
    expect(r.years[0]).toMatchObject({ year: 2026, income: 110000, spending: 30000 })
    // One rule: the same numbers as Finance's own Reports.
    const rep = report(s, '2026-04-01', '2026-04-30', { withPrev: false })
    expect([rep.income, rep.expense]).toEqual([110000, 30000])
    expect(r.thisYear).toBeCloseTo(rep.savingsRate)
  })

  it('an empty month and a month without income have no rate; the trend compares 3 full months with the 3 before', () => {
    const list: any[] = []
    // Jan–Mar: earn 1000, spend 800 (20%). Apr: nothing. May–Jun: earn 1000, spend 500 (50%).
    for (const m of ['01', '02', '03', '05', '06']) {
      list.push(tx({ type: 'income', category: 'work', amount: 100000, date: `2026-${m}-01` }))
      list.push(tx({ amount: m < '04' ? 80000 : 50000, date: `2026-${m}-10` }))
    }
    list.push(tx({ amount: 1000, date: '2026-07-02' }))
    const r = savingsRates(state({ tx: list }), '2026-07-15')
    expect(r.months.map((m: any) => m.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])
    expect(r.months[3].rate).toBeNull()
    expect(r.months[6].rate).toBeNull()
    // last 3 full months: Apr (0/0), May, Jun -> (2000 − 1000) / 2000 = 50%; before: Jan–Mar 20%.
    expect(r.trend.last3).toBeCloseTo(0.5)
    expect(r.trend.prev3).toBeCloseTo(0.2)
    expect(r.trend.diff).toBe(30)
  })

  it('uses each record’s own value in the main currency (its day’s rate)', () => {
    const s = state({
      tx: [
        tx({ type: 'income', category: 'work', currency: 'EUR', amount: 10000, rate: 20, base: 200000, date: '2026-05-01' }),
        tx({ currency: 'USD', amount: 5000, rate: 18, base: 90000, date: '2026-05-02' })
      ]
    })
    expect(savingsRates(s, '2026-05-31').months[0].rate).toBeCloseTo(0.55)
  })
})

describe('this year against last year', () => {
  const s = state({
    tx: [
      tx({ category: 'food', amount: 10000, date: '2025-02-10' }),
      tx({ category: 'food', amount: 50000, date: '2025-12-10' }),
      tx({ category: 'fun', amount: 30000, date: '2025-03-01' }),
      tx({ category: 'home', amount: 20000, date: '2025-01-15' }),
      tx({ category: 'food', amount: 25000, date: '2026-02-10' }),
      tx({ category: 'fun', amount: 5000, date: '2026-03-01' }),
      tx({ category: 'clothes', amount: 8000, date: '2026-01-20' }),
      tx({ type: 'income', category: 'food', amount: 5000, date: '2026-02-11' }),
      tx({ type: 'transfer', amount: 99999, date: '2026-02-12', from: 'cash', to: 'safe' })
    ]
  })

  it('so far: 1 January to today against the same days last year; income and transfers are not spending', () => {
    const y = yearOverYear(s, 2026, '2026-06-30')
    expect(y.prev).toEqual({ from: '2025-01-01', to: '2025-06-30' })
    const row = (id: string) => y.rows.find((r: any) => r.id === id)
    expect(row('food')).toMatchObject({ now: 25000, before: 10000, diff: 15000, change: 1.5 })
    expect(row('fun')).toMatchObject({ now: 5000, before: 30000, diff: -25000 })
    expect(row('clothes')).toMatchObject({ now: 8000, before: 0, change: null })
    expect(row('home')).toMatchObject({ now: 0, before: 20000 })
    expect(y.total).toEqual({ now: 38000, before: 60000 })
    expect(y.up.map((r: any) => r.id)).toEqual(['food', 'clothes'])
    expect(y.down.map((r: any) => r.id)).toEqual(['fun', 'home'])
  })

  it('full year: the whole year against the whole year before', () => {
    const y = yearOverYear(s, 2026, '2026-06-30', { mode: 'full' })
    expect(y.to).toBe('2026-12-31')
    expect(y.rows.find((r: any) => r.id === 'food')).toMatchObject({ now: 25000, before: 60000 })
  })

  it('29 February compares with 28 February', () => {
    const y = yearOverYear(state(), 2028, '2028-02-29')
    expect(y.prev.to).toBe('2027-02-28')
  })
})

describe('runway', () => {
  it('liquid savings (crypto left out) ÷ average spending of the last full months; gaps are skipped', () => {
    const list: any[] = []
    // Spending 1000 / month for Jan–Mar, 2000 / month for Jul–Oct; nothing at all in Apr–Jun (a gap).
    for (const m of ['01', '02', '03']) list.push(tx({ amount: 100000, date: `2026-${m}-05` }))
    for (const m of ['07', '08', '09', '10']) list.push(tx({ amount: 200000, date: `2026-${m}-05` }))
    list.push(tx({ type: 'transfer', amount: 500000, from: 'cash', to: 'safe', date: '2026-10-06' }))
    const s = state({
      settings: { accounts: [acc('cash', { start: 2000000 }), acc('safe', { kind: 'savings', start: 1000000 }), acc('btc', { kind: 'crypto', currency: 'USD', start: 0, holdings: [{ asset: 'BTC', qty: 1 }] })] },
      tx: list,
      rates: { usd: { USD: 1, MDL: 20 }, crypto: { BTC: 50000 }, history: {} }
    })
    const r = runway(s, '2026-11-12')
    // 30 000 − 11 000 spent = 19 000 MDL liquid
    expect(r.liquid).toBe(1900000)
    expect(r.leftOut).toEqual(['btc'])
    const w = (k: number) => r.windows.find((x: any) => x.months === k)
    expect(w(3)).toMatchObject({ used: 3, average: 200000 })
    expect(w(3).runway).toBeCloseTo(9.5)
    expect(w(6)).toMatchObject({ used: 6, average: 166667 })
    expect(w(12)).toMatchObject({ used: 7 })
    expect(r.text).toBe('You could live 11 months on your savings.')
    expect(runwayText(1900000, w(3))).toBe('You could live 9,5 months on your savings.')
  })

  it('first month of data: this month so far, scaled to a whole month', () => {
    const s = state({ tx: [tx({ amount: 10000, date: '2026-11-02' }), tx({ amount: 10000, date: '2026-11-09' })] })
    const r = runway(s, '2026-11-10')
    expect(r.main.estimated).toBe(true)
    expect(r.main.average).toBe(Math.round((20000 / 10) * 30.44))
    expect(r.liquid).toBe(80000)
  })

  it('says so when nothing is spent or savings are gone', () => {
    expect(runway(state(), '2026-11-10').text).toMatch(/No spending logged yet/)
    expect(runwayText(-5, { runway: 0 })).toMatch(/would not cover a month/)
    expect(monthsText(1)).toBe('1')
    expect(runwayText(100, { runway: 1 })).toBe('You could live 1 month on your savings.')
  })
})

describe('snapshots, today and other currencies', () => {
  it('a saved snapshot wins in its month when nothing was logged after it; otherwise the month is rebuilt', () => {
    const s: any = state({
      tx: [tx({ amount: 10000, date: '2026-01-10' }), tx({ amount: 10000, date: '2026-02-05' }), tx({ amount: 10000, date: '2026-02-25' })]
    })
    s.netWorth = [
      { id: 'nw-2026-01-28', date: '2026-01-28', total: 95000, crypto: 0 },
      { id: 'nw-2026-02-20', date: '2026-02-20', total: 85000, crypto: 0 }
    ]
    const h = netWorthHistory(s, '2026-03-05')
    expect(h.months.map((m: any) => [m.key, m.total, m.source])).toEqual([
      ['2026-01', 95000, 'snapshot'],
      ['2026-02', 70000, 'rebuilt'],
      ['2026-03', 70000, 'today']
    ])
    expect(h.months[0].rebuilt).toBe(90000)
    // A book view never uses snapshots (they hold every book).
    expect(netWorthHistory(s, '2026-03-05', { book: 'personal' }).months[0].source).toBe('rebuilt')
  })

  it("the last point equals Finance's own total today (open accounts, coins, known rates)", () => {
    const s = state({
      settings: {
        accounts: [
          acc('cash', { start: 100000 }),
          acc('old', { start: 0, archived: true }),
          acc('usd', { currency: 'USD', start: 10000 }),
          acc('btc', { kind: 'crypto', currency: 'USD', start: 0, holdings: [{ asset: 'BTC', qty: 0.002 }] })
        ]
      },
      tx: [tx({ type: 'transfer', amount: 30000, from: 'cash', to: 'old', date: '2026-01-04' }), tx({ amount: 5000, date: '2026-02-04' })],
      rates: { usd: { USD: 1, MDL: 18 }, crypto: { BTC: 60000 }, history: {} }
    })
    const h = netWorthHistory(s, '2026-02-10')
    expect(h.now).toBe(totalBalance(s).total)
    // In January the archived account still held the money it got.
    expect(h.months[0].byAccount.old).toBe(30000)
  })

  it('shows net worth, savings and runway in USD or EUR at the rate of each day', () => {
    // MDL per USD: 17 in January, 20 in February (saved days); today 25.
    const s = state({
      tx: [
        tx({ type: 'income', category: 'work', amount: 170000, date: '2026-01-05' }),
        tx({ amount: 85000, date: '2026-01-06' }),
        tx({ type: 'income', category: 'work', amount: 200000, date: '2026-02-05' }),
        tx({ amount: 40000, date: '2026-02-06' })
      ],
      rates: { usd: { USD: 1, MDL: 25, EUR: 1 }, history: { '2026-01-01': { USD: 1, MDL: 17, EUR: 1 }, '2026-02-01': { USD: 1, MDL: 20, EUR: 1 } } }
    })
    expect(viewCurrencies(s, '2026-03-10')).toEqual(['MDL', 'USD', 'EUR'])
    const mdl = netWorthHistory(s, '2026-03-10')
    const usd = netWorthHistory(s, '2026-03-10', { cur: 'USD' })
    expect(usd.currency).toBe('USD')
    expect(mdl.months.map((m: any) => m.total)).toEqual([185000, 345000, 345000])
    expect(usd.months.map((m: any) => m.total)).toEqual([Math.round(185000 / 17), Math.round(345000 / 20), Math.round(345000 / 25)])
    // Each record at its own day's rate: January 1 000 USD in, 500 USD out; February 1 000 in, 200 out.
    const sr = savingsRates(s, '2026-03-10', { cur: 'USD' })
    expect(sr.currency).toBe('USD')
    expect(sr.months.slice(0, 2).map((m: any) => [m.income, m.spending])).toEqual([[10000, 5000], [10000, 2000]])
    expect(sr.thisYear).toBeCloseTo(13000 / 20000)
    const rw = runway(s, '2026-03-10', { cur: 'USD' })
    expect(rw.currency).toBe('USD')
    expect(rw.liquid).toBe(Math.round(345000 / 25))
    expect(rw.windows[0].average).toBe(3500)
    const y = yearOverYear(s, 2026, '2026-03-10', { cur: 'USD' })
    expect(y.total.now).toBe(7000)
  })

  it('a currency without any rate is not offered and falls back to MDL (never 1:1)', () => {
    const s = state({ tx: [tx({ amount: 1000, date: '2026-01-05' })] })
    expect(viewCurrencies(s, '2026-01-10')).toEqual(['MDL'])
    const h = netWorthHistory(s, '2026-01-10', { cur: 'EUR' })
    expect(h.currency).toBe('MDL')
    expect(h.now).toBe(99000)
  })

  it('30 years of records stay fast', () => {
    const list: any[] = []
    for (let y = 1997; y <= 2026; y++) {
      for (let i = 0; i < 3000; i++) {
        const m = String((i % 12) + 1).padStart(2, '0')
        const d = String((i % 28) + 1).padStart(2, '0')
        list.push(i % 10 ? tx({ amount: 1000 + i, date: `${y}-${m}-${d}`, category: i % 3 ? 'food' : 'fun' }) : tx({ type: 'income', category: 'work', amount: 50000, date: `${y}-${m}-${d}` }))
      }
    }
    const s = state({ tx: list })
    const t0 = performance.now()
    netWorthHistory(s, '2026-11-12')
    savingsRates(s, '2026-11-12')
    yearOverYear(s, 2026, '2026-11-12')
    runway(s, '2026-11-12')
    // 90 000 records; a generous limit for slower CI and Windows runners.
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('the Money page card', () => {
  it('has net worth, its change this year, the savings rate and the runway', () => {
    const s = state({
      tx: [
        tx({ amount: 10000, date: '2025-12-20' }),
        tx({ type: 'income', category: 'work', amount: 100000, date: '2026-01-05' }),
        tx({ amount: 40000, date: '2026-01-10' })
      ]
    })
    const c = longCard(s, '2026-02-15')
    expect(c).toMatchObject({ currency: 'MDL', netWorth: 150000, changeThisYear: 60000, missing: 0 })
    expect(c.savingsRate).toBeCloseTo(0.6)
    expect(c.runwayText).toMatch(/You could live/)
  })

  it('never changes the data it reads', () => {
    const s = state({ tx: [tx({ type: 'income', category: 'food', amount: 100, date: '2026-01-05' }), tx({ amount: 40000, date: '2026-01-10' })] })
    const before = JSON.stringify(s)
    longCard(s, '2026-02-15')
    yearOverYear(s, 2026, '2026-02-15')
    expect(JSON.stringify(s)).toBe(before)
  })
})
