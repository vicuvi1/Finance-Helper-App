// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyTrust.test.ts) by scripts/port-mega-tests.mjs. 5 test(s) that need Life System code (./moneyHub) are left out.
// Money trust (Phase 1): every total Finance Helper and the Money hub show is
// proved here with property tests (hundreds of random made-up states from a
// fixed seed, so a failure always reproduces) and small fixtures. Made-up
// data only. No clock or OS assumptions: every date is passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { countsAsSpending, categoryShares } from '../../js/catshare.js'
// @ts-ignore
import { safeToSpend, everydaySpent, isEveryday } from '../../js/safespend.js'
// @ts-ignore
import { yearReview } from '../../js/yearreview.js'
// @ts-ignore
import { occurrences, dueItems, upcomingItems, makeTx, markDone, perMonth, nth } from '../../js/recurring.js'
// @ts-ignore
import { planSplit, splitTransfers } from '../../js/split.js'
// @ts-ignore
import { effectOn } from '../../js/reconcile.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'

// ---------- a seeded random generator of made-up money ----------

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type R = () => number
const int = (r: R, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const pick = <T,>(r: R, list: T[]): T => list[Math.floor(r() * list.length)]
const pad = (n: number) => String(n).padStart(2, '0')
const dayIn = (r: R, year: number, month: number) => `${year}-${pad(month)}-${pad(int(r, 1, 28))}`

// Units per 1 USD (made up): 1 USD = 17.6 MDL, 1 EUR = 20 MDL.
const RATES = { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: 1 }
const RATE_TO_MDL: Record<string, number> = { MDL: 1, USD: 17.6, EUR: 20 }

const ACCOUNTS = [
  { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 50000 },
  { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 120000 },
  { id: 'usd', name: 'Dollar card', kind: 'card', currency: 'USD', start: 30000 },
  { id: 'eur', name: 'Euro card', kind: 'card', currency: 'EUR', start: 0 },
  { id: 'safe', name: 'Safe', kind: 'savings', currency: 'MDL', savings: true, start: 500000 }
]
const EXP_CATS = ['food', 'transport', 'fun', 'home', 'health', 'clothes']
const INC_CATS = ['work', 'family', 'side']

/** A random but valid Finance Helper state for one year (2026), in the past of `today`. */
function randomState(seed: number, { n = 80, transfers = true, loans = true, rewards = true } = {}) {
  const r = rng(seed)
  let id = 0
  const tx: any[] = []
  const accCur = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a.currency]))
  const priced = (amount: number, cur: string, date: string) => {
    // Each record keeps the rate of its own day (made up: it drifts by month).
    const drift = 1 + (Number(date.slice(5, 7)) - 6) / 100
    const rate = cur === 'MDL' ? 1 : Math.round(RATE_TO_MDL[cur] * drift * 10000) / 10000
    return { currency: cur, rate, base: Math.round(amount * rate) }
  }
  for (let i = 0; i < n; i++) {
    const date = dayIn(r, 2026, int(r, 1, 10))
    const kind = r()
    const stamp = ++id
    if (transfers && kind < 0.2) {
      const from = pick(r, ACCOUNTS).id
      let to = pick(r, ACCOUNTS).id
      if (to === from) to = from === 'card' ? 'wallet' : 'card'
      const amount = int(r, 100, 40000)
      const t: any = { id: `t${stamp}`, type: 'transfer', amount, date, from, to, note: 'move', createdAt: stamp, updatedAt: stamp, ...priced(amount, accCur[from], date) }
      if (accCur[from] !== accCur[to]) t.toAmount = Math.round((amount * RATE_TO_MDL[accCur[from]]) / RATE_TO_MDL[accCur[to]])
      tx.push(t)
      continue
    }
    const account = pick(r, ACCOUNTS.filter((a) => a.id !== 'safe')).id
    const income = kind < 0.4
    const amount = int(r, 50, income ? 900000 : 60000)
    const t: any = { id: `t${stamp}`, type: income ? 'income' : 'expense', amount, date, account, category: income ? pick(r, INC_CATS) : pick(r, EXP_CATS), note: `note ${int(r, 1, 9)}`, createdAt: stamp, updatedAt: stamp, ...priced(amount, accCur[account], date) }
    if (loans && r() < 0.07) {
      t.loan = true
      t.person = 'p1'
    }
    if (rewards && !income && r() < 0.04) t.id = `life-reward-${stamp}`
    tx.push(t)
  }
  return M.normalizeState({
    settings: { currency: 'MDL', accounts: ACCOUNTS.map((a) => ({ ...a })) },
    people: [{ id: 'p1', name: 'Friend' }],
    tx,
    rates: RATES
  })
}

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919)
const sum = (list: any[], f: (t: any) => number) => list.reduce((a, t) => a + f(t), 0)
const B = (t: any) => (Number.isInteger(t.base) ? t.base : t.amount)

// ---------- account balances and transfers ----------

describe('account balances', () => {
  it('every balance is its start plus the signed effect of each record on it (in its own currency)', () => {
    for (const seed of SEEDS) {
      const s = randomState(seed)
      const bal = M.accountBalances(s)
      for (const a of s.settings.accounts) {
        expect(bal[a.id]).toBe((a.start || 0) + sum(s.tx, (t) => effectOn(t, a.id)))
      }
    }
  })

  // (left out here: needs Life System code)

  it('a move between currencies takes its amount from one side and gives toAmount to the other', () => {
    const s = randomState(3, { n: 0 })
    s.tx.push({ id: 'x', type: 'transfer', amount: 10000, currency: 'USD', rate: 17.6, base: 176000, toAmount: 176000, date: '2026-02-01', from: 'usd', to: 'card', createdAt: 1, updatedAt: 1 })
    const bal = M.accountBalances(s)
    expect(bal.usd).toBe(30000 - 10000)
    expect(bal.card).toBe(120000 + 176000)
    expect(M.monthSummary(s, '2026-02').expense).toBe(0)
  })

  it('balances up to a day leave out what comes later', () => {
    const s = randomState(5)
    const day = '2026-05-15'
    const bal = M.accountBalances(s, day)
    for (const a of s.settings.accounts) expect(bal[a.id]).toBe((a.start || 0) + sum(s.tx.filter((t: any) => t.date <= day), (t) => effectOn(t, a.id)))
  })
})

// ---------- spending, income and the one spending rule ----------

describe('what counts as spending and income', () => {
  it('monthSummary, totalsByCategory, report and the donut all use one spending rule', () => {
    for (const seed of SEEDS) {
      const s = randomState(seed)
      for (const m of ['2026-02', '2026-07']) {
        const from = `${m}-01`
        const to = `${m}-31`
        const want = sum(s.tx.filter((t: any) => t.date.startsWith(m) && countsAsSpending(t)), B)
        expect(M.monthSummary(s, m).expense).toBe(want)
        expect(M.totalsByCategory(s, from, to, 'expense').total).toBe(want)
        expect(M.report(s, from, to).expense).toBe(want)
        const shares = categoryShares(s.tx, { from, to }, B)
        expect(shares.total).toBe(want)
      }
    }
  })

  it('a reward bought with points (life-reward-…) is not spending anywhere, though it was logged as an expense', () => {
    const s = randomState(11, { n: 0 })
    s.tx.push({ id: 'life-reward-9', type: 'expense', amount: 1500, currency: 'MDL', rate: 1, base: 1500, date: '2026-04-02', account: 'card', category: 'fun', note: 'Reward', createdAt: 1, updatedAt: 1 })
    expect(M.monthSummary(s, '2026-04').expense).toBe(0)
    expect(M.report(s, '2026-04-01', '2026-04-30').expense).toBe(0)
    expect(yearReview(s, 2026, '2026-12-31').expense).toBe(0)
    expect(everydaySpent(s, '2026-04-02', '2026-04-02')).toBe(0)
    expect(safeToSpend(s, '2026-04-02').spentToday).toBe(0)
  })

  it('loans (lent, borrowed, paid back) move balances but are never income or spending', () => {
    const s = randomState(12, { n: 0 })
    const add = (t: any) => s.tx.push({ currency: 'MDL', rate: 1, createdAt: 1, updatedAt: 1, ...t, base: t.amount })
    add({ id: 'l1', type: 'expense', amount: 20000, date: '2026-03-01', account: 'card', category: 'other', loan: true, person: 'p1' })
    add({ id: 'l2', type: 'income', amount: 20000, date: '2026-03-20', account: 'card', category: 'other-in', loan: true, person: 'p1' })
    expect(M.monthSummary(s, '2026-03')).toMatchObject({ income: 0, expense: 0 })
    expect(M.accountBalances(s).card).toBe(120000)
    const row = M.peopleSummary(s).find((x: any) => x.person.id === 'p1')
    expect(row.owesMe).toBe(0)
    expect(row.owes).toEqual({})
  })
})

// ---------- refunds ----------

describe('refunds', () => {
  // Finance Helper has no separate refund type yet: money back is logged as
  // income (Other income) in the account it came back to. Proved here: the
  // balance is exact, nothing is counted twice, and Finance and the hub agree.
  // (left out here: needs Life System code)
})

// ---------- several currencies with the rates of their day ----------

describe('several currencies, each record at the rate of its day', () => {
  it('month totals use each record\'s own value in MDL: new live rates never change past months', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const s = randomState(seed)
      const before = M.yearOverview(s, 2026)
      s.rates = { ...RATES, usd: { USD: 1, MDL: 19.9, EUR: 0.7 } }
      expect(M.yearOverview(s, 2026)).toEqual(before)
    }
  })

  it('today\'s total converts each account at today\'s rate; a record keeps its own', () => {
    const s = randomState(31, { n: 0 })
    // 300 USD (start) at 17.6 = 5 280 MDL; EUR empty.
    const tot = M.totalBalance(s).total
    expect(tot).toBe(50000 + 120000 + Math.round(30000 * 17.6) + 500000)
  })

  it('a foreign account still counts when this device has no live rate (known rates from records)', () => {
    const s = randomState(32, { n: 0 })
    s.tx.push({ id: 'u1', type: 'expense', amount: 1000, currency: 'USD', rate: 18, base: 18000, date: '2026-01-05', account: 'usd', category: 'food', createdAt: 1, updatedAt: 1 })
    s.rates = null
    const v = M.accountValues(s).find((x: any) => x.account.id === 'usd')
    expect(v.inBase).toBe(Math.round(29000 * 18))
    // Safe to spend sees the same money as the total.
    const safe = safeToSpend(s, '2026-01-20')
    expect(safe.liquid).toBe(50000 + 120000 + Math.round(29000 * 18))
  })

  it('switching an account to another currency keeps every record\'s value in MDL', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const s = randomState(seed)
      const before = M.report(s, '2026-01-01', '2026-12-31')
      M.changeAccountCurrency(s, 'card', 'USD', 17.6, 5)
      const after = M.report(s, '2026-01-01', '2026-12-31')
      expect([after.income, after.expense]).toEqual([before.income, before.expense])
    }
  })
})

// ---------- split bills and debts ----------

describe('split bills and debts', () => {
  it('splitting a receipt keeps the amount, its MDL value and the balance exactly', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const r = rng(seed)
      const s = randomState(seed)
      const t = s.tx.find((x: any) => x.type === 'expense' && x.amount >= 300)
      if (!t) continue
      const k = int(r, 2, 4)
      const parts: any[] = []
      let left = t.amount
      for (let i = 0; i < k; i++) {
        const a = i === k - 1 ? left : int(r, 1, left - (k - i - 1))
        parts.push({ amount: a, category: pick(r, EXP_CATS) })
        left -= a
      }
      const before = { bal: M.accountBalances(s), spent: M.monthSummary(s, t.date.slice(0, 7)).expense }
      const out = M.splitRecord(t, parts, 7)
      expect(out).not.toBeNull()
      expect(sum(out, (x) => x.amount)).toBe(t.amount)
      expect(sum(out, (x) => x.base)).toBe(B(t))
      s.tx = s.tx.filter((x: any) => x.id !== t.id).concat(out)
      expect(M.accountBalances(s)).toEqual(before.bal)
      expect(M.monthSummary(s, t.date.slice(0, 7)).expense).toBe(before.spent)
    }
  })

  it('a debt in another currency stays in that currency; paying it back closes it', () => {
    const s = randomState(41, { n: 0 })
    const e = M.entryAmounts(10000, 'USD', 'MDL', 17.6, { loan: true })
    s.tx.push({ id: 'd1', type: 'expense', amount: e.amount, currency: 'MDL', rate: 1, base: e.amount, orig: e.orig, debt: e.debt, date: '2026-02-01', account: 'card', category: 'other', loan: true, person: 'p1', createdAt: 1, updatedAt: 1 })
    let row = M.peopleSummary(s).find((x: any) => x.person.id === 'p1')
    expect(row.owes).toEqual({ USD: 10000 })
    const back = M.entryAmounts(10000, 'USD', 'MDL', 19, { loan: true })
    s.tx.push({ id: 'd2', type: 'income', amount: back.amount, currency: 'MDL', rate: 1, base: back.amount, orig: back.orig, debt: back.debt, date: '2026-03-01', account: 'card', category: 'other-in', loan: true, person: 'p1', createdAt: 2, updatedAt: 2 })
    row = M.peopleSummary(s).find((x: any) => x.person.id === 'p1')
    expect(row.owes).toEqual({})
    // The rate moved, so the card got 2 MDL × 100 more back: real money, not income.
    expect(M.accountBalances(s).card).toBe(120000 - 176000 + 190000)
    expect(M.monthSummary(s, '2026-03').income).toBe(0)
  })

  it('splitting an income into jars moves money between accounts without changing any total', () => {
    const s = randomState(42, { n: 0 })
    const inc = { id: 'pay', type: 'income', amount: 1000000, currency: 'MDL', rate: 1, base: 1000000, date: '2026-05-01', account: 'card', category: 'work', createdAt: 1, updatedAt: 1 }
    s.tx.push(inc)
    s.settings.jars = s.settings.jars.map((j: any) => (j.savings ? { ...j, account: 'safe' } : j))
    const before = { total: M.totalBalance(s).total, m: M.monthSummary(s, '2026-05') }
    let k = 0
    const { transfers } = splitTransfers(s, inc, planSplit(s, inc), { now: 5, uid: () => `s${++k}` })
    s.tx.push(...transfers)
    expect(M.totalBalance(s).total).toBe(before.total)
    expect(M.monthSummary(s, '2026-05')).toMatchObject({ income: before.m.income, expense: before.m.expense })
    expect(M.accountBalances(s).safe).toBe(500000 + 700000)
  })
})

// ---------- recurring items ----------

describe('recurring items', () => {
  it('dates are in order, inside the range, and a monthly rule on the 31st falls on each month\'s last day', () => {
    const rule = { id: 'r', every: 'month', start: '2026-01-31', amount: 100 }
    expect(occurrences(rule, '2026-01-01', '2026-06-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
    for (const every of ['week', '2weeks', 'month', '3months', 'year']) {
      const r = { id: 'r', every, start: '2025-11-17', amount: 100 }
      const list = occurrences(r, '2026-01-01', '2026-12-31')
      expect([...list].sort()).toEqual(list)
      expect(new Set(list).size).toBe(list.length)
      for (const d of list) expect(d >= '2026-01-01' && d <= '2026-12-31').toBe(true)
    }
    expect(nth({ every: 'year', start: '2024-02-29' }, 1)).toBe('2025-02-28')
  })

  it('a due date is due until logged or skipped, then never again; upcoming starts after today', () => {
    const s = randomState(51, { n: 0 })
    const rule = { id: 'rent', type: 'expense', every: 'month', start: '2026-01-05', amount: 300000, currency: 'MDL', account: 'card', category: 'home', note: 'Rent', updatedAt: 0, lastDone: null, paused: false }
    s.recurring.push(rule)
    expect(dueItems(s, '2026-03-10').map((x: any) => x.date)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05'])
    for (const d of ['2026-01-05', '2026-02-05']) s.tx.push(makeTx(rule, d, { id: `r-${d}`, now: 1 }))
    markDone(rule, '2026-02-05', 2)
    expect(dueItems(s, '2026-03-10').map((x: any) => x.date)).toEqual(['2026-03-05'])
    expect(upcomingItems(s, '2026-03-10', 31).map((x: any) => x.date)).toEqual(['2026-04-05'])
    expect(M.accountBalances(s).card).toBe(120000 - 600000)
  })

  it('a rule in USD makes records in USD with that day\'s value in MDL; its monthly cost is per month', () => {
    const rule = { id: 'sub', type: 'expense', every: 'month', start: '2026-01-01', amount: 1000, currency: 'USD', account: 'usd', category: 'subscriptions' }
    const t = makeTx(rule, '2026-02-01', { id: 'x', rate: 17.5, now: 1 })
    expect([t.amount, t.currency, t.base]).toEqual([1000, 'USD', 17500])
    expect(perMonth({ ...rule, every: 'week' })).toBe(Math.round((1000 * 52) / 12))
    expect(perMonth({ ...rule, every: 'year' })).toBe(Math.round(1000 / 12))
  })

  // (left out here: needs Life System code)
})

// ---------- safe to spend ----------

describe('safe to spend', () => {
  const base = () => {
    const s = randomState(61, { n: 0 })
    s.settings.accounts = s.settings.accounts.filter((a: any) => a.id !== 'usd' && a.id !== 'eur')
    return s
  }

  it('is the money on cards and in cash minus bills before payday, spread over the days, rounded down', () => {
    const s = base()
    s.recurring.push({ id: 'rent', type: 'expense', every: 'month', start: '2026-01-25', amount: 30000, currency: 'MDL', account: 'card', category: 'home', note: 'Rent', updatedAt: 0, lastDone: '2026-02-25', paused: false })
    const r = safeToSpend(s, '2026-03-11')
    expect(r.liquid).toBe(50000 + 120000)
    expect(r.payday).toBe('2026-04-01')
    expect(r.days).toBe(21)
    expect(r.billsTotal).toBe(30000)
    expect(r.perDay).toBe(Math.floor((170000 - 30000) / 21 / 100) * 100)
  })

  it('today\'s everyday spending counts against today\'s share, not the pool', () => {
    const s = base()
    s.tx.push({ id: 'a', type: 'expense', amount: 5000, currency: 'MDL', rate: 1, base: 5000, date: '2026-03-11', account: 'wallet', category: 'food', createdAt: 1, updatedAt: 1 })
    const r = safeToSpend(s, '2026-03-11')
    expect(r.spentToday).toBe(5000)
    expect(r.pool).toBe(170000)
    expect(r.leftToday).toBe(r.perDay - 5000)
  })

  it('money logged ahead (dated after today) is not spendable yet', () => {
    const s = base()
    s.tx.push({ id: 'f', type: 'income', amount: 900000, currency: 'MDL', rate: 1, base: 900000, date: '2026-03-25', account: 'card', category: 'work', createdAt: 1, updatedAt: 1 })
    expect(safeToSpend(s, '2026-03-11').liquid).toBe(170000)
    expect(safeToSpend(s, '2026-03-25').liquid).toBe(170000 + 900000)
  })

  // (left out here: needs Life System code)
})

// ---------- net worth ----------

describe('net worth', () => {
  it('is every account at today\'s rate; this month\'s point is today\'s total; old months are rebuilt from records', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const s = randomState(seed)
      const today = '2026-11-12'
      const total = M.totalBalance(s).total
      const want = sum(s.settings.accounts, (a: any) => Math.round(M.accountBalances(s)[a.id] * RATE_TO_MDL[a.currency]))
      // convert() rounds each account once.
      expect(Math.abs(total - want)).toBeLessThanOrEqual(s.settings.accounts.length)
      const series = M.netWorthSeries(s, today, 12)
      expect(series.at(-1).value).toBe(total)
      // Nothing happens after October: November's start equals today's records.
      expect(M.rebuiltTotal(s, '2026-10-31')).toBe(M.rebuiltTotal(s, today))
    }
  })

  it('a transfer never changes net worth; income and spending change it by their amount', () => {
    const s = randomState(71, { n: 0 })
    const t0 = M.totalBalance(s).total
    s.tx.push({ id: 'm', type: 'transfer', amount: 40000, currency: 'MDL', rate: 1, base: 40000, date: '2026-01-02', from: 'card', to: 'safe', createdAt: 1, updatedAt: 1 })
    expect(M.totalBalance(s).total).toBe(t0)
    s.tx.push({ id: 'e', type: 'expense', amount: 2500, currency: 'MDL', rate: 1, base: 2500, date: '2026-01-03', account: 'wallet', category: 'food', createdAt: 2, updatedAt: 2 })
    expect(M.totalBalance(s).total).toBe(t0 - 2500)
  })

  it('a rebuilt month uses the same known rates as today\'s total (no live rate on this device)', () => {
    const s = randomState(72, { n: 0 })
    s.tx.push({ id: 'u1', type: 'income', amount: 1000, currency: 'USD', rate: 18, base: 18000, date: '2026-01-05', account: 'usd', category: 'work', createdAt: 1, updatedAt: 1 })
    s.rates = null
    expect(M.rebuiltTotal(s, '2026-12-31')).toBe(M.totalBalance(s).total)
  })
})

// ---------- the year review ----------

describe('year review totals', () => {
  it('income, spending and net are the twelve months added up, and the same as the year report', () => {
    for (const seed of SEEDS) {
      const s = randomState(seed)
      const y = yearReview(s, 2026, '2026-12-31')
      const months = M.yearOverview(s, 2026)
      expect(y.income).toBe(months.total.income)
      expect(y.expense).toBe(months.total.expense)
      expect(y.net).toBe(y.income - y.expense)
      const rep = M.report(s, '2026-01-01', '2026-12-31')
      expect([y.income, y.expense]).toEqual([rep.income, rep.expense])
      expect(y.records).toBe(s.tx.filter((t: any) => t.date.startsWith('2026')).length)
      // Net worth at the end of the year is today's money rebuilt from records.
      expect(y.netWorth.end).toBe(M.rebuiltTotal(s, '2026-12-31'))
    }
  })
})

// ---------- the Money hub matches Finance ----------

describe('the Money hub matches Finance Helper', () => {
  // (left out here: needs Life System code)

  it('after a sync merge both devices show the same totals', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const a = randomState(seed)
      const b = randomState(seed + 1)
      const merged = mergeStates(a, toCloud(b, 'dev2')).state
      const back = mergeStates(b, toCloud(a, 'dev1')).state
      expect(M.yearOverview(merged, 2026)).toEqual(M.yearOverview(back, 2026))
      expect(M.accountBalances(merged)).toEqual(M.accountBalances(back))
    }
  })
})
