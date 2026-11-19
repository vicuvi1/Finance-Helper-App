// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeMoneyIdeasB.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper "money ideas B" (made-up data, the clock pinned by passing
// today): the one-line quick add, the salary watch, price memory and Ask about
// your money, including that the new salary setting survives a sync.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS module from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore plain JS module from the embedded app
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore plain JS module from the embedded app
import { parseQuick } from '../../js/quickadd.js'
// @ts-ignore plain JS module from the embedded app
import { salaryStatus } from '../../js/salary.js'
// @ts-ignore plain JS module from the embedded app
import { priceMemory } from '../../js/prices.js'
// @ts-ignore plain JS module from the embedded app
import { askMoney, CANT } from '../../js/ask.js'
// @ts-ignore plain JS module from the embedded app
import { load } from '../../js/store.js'

const TODAY = '2026-11-13' // a Friday
let n = 0
const tx = (date: string, amount: number, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date, category: 'food', account: 'card', note: '', createdAt: n, updatedAt: n, ...extra })

function seeded(extra: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return M.normalizeState({
    settings: { ...settings },
    tx: [
      // October: food 300 + 200 (Linella), a 1 200 headphones buy, 5 000 salary.
      tx('2026-10-01', 500000, { type: 'income', category: 'work', note: 'Salary' }),
      tx('2026-10-03', 30000, { note: 'Linella' }), tx('2026-10-05', 20000, { note: 'Linella' }),
      tx('2026-10-08', 120000, { category: 'fun', note: 'Headphones' }),
      // November (today is the 13th).
      tx('2026-11-02', 14800, { note: 'Linella 23' }), tx('2026-11-04', 13200, { note: 'Linella' }), tx('2026-11-06', 14100, { note: 'Linella #4411' }),
      tx('2026-11-08', 60000, { category: 'fun', note: 'Cinema' }),
      tx('2026-11-09', 10000, { category: 'fun', note: 'Cinema refund', type: 'income', refund: true }),
      // "lunch" is filed under Fun & going out three times: that is what quick add should learn.
      tx('2026-11-10', 9000, { category: 'fun', note: 'Lunch' }), tx('2026-11-11', 9500, { category: 'fun', note: 'lunch' }), tx('2026-11-12', 8800, { category: 'fun', note: 'Lunch' }),
    ],
    ...extra,
  })
}

describe('quick add', () => {
  it('"120 lunch" is a 120 expense in the category you chose before for lunch', () => {
    const r = parseQuick(seeded(), '120 lunch', { today: TODAY })
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('expense')
    expect(r.tx).toMatchObject({ type: 'expense', amount: 12000, currency: 'MDL', base: 12000, category: 'fun', note: 'lunch', date: TODAY })
    expect(r.level).toBe('sure')
    expect(r.tx.catBy).toBeUndefined() // learned from your own records: fine to learn from
  })

  it('"45.5 coffee card" names the account and keeps the word out of the note', () => {
    const r = parseQuick(seeded(), '45.5 coffee card', { today: TODAY })
    expect(r.ok).toBe(true)
    expect(r.tx).toMatchObject({ amount: 4550, account: 'card', note: 'coffee' })
  })

  it('a + means income, a leading minus is a refund that lowers spending', () => {
    const s = seeded()
    const inc = parseQuick(s, '3000 salary +', { today: TODAY })
    expect(inc.ok).toBe(true)
    expect(inc.kind).toBe('income')
    expect(inc.tx).toMatchObject({ type: 'income', amount: 300000, note: 'salary', category: 'work' })
    const ref = parseQuick(s, '-300 tech refund', { today: TODAY })
    expect(ref.ok).toBe(true)
    expect(ref.kind).toBe('refund')
    expect(ref.tx).toMatchObject({ type: 'income', refund: true, amount: 30000 })
  })

  it('the category you pick wins over the guess', () => {
    const r = parseQuick(seeded(), '120 lunch', { today: TODAY, catOverride: 'transport' })
    expect(r.tx.category).toBe('transport')
    expect(r.level).toBe('chosen')
  })

  it('a currency word or symbol uses that currency (with a rate), the main one otherwise', () => {
    const s = seeded({ rates: { usd: { MDL: 18, USD: 1 }, fetchedAt: 1 } })
    const r = parseQuick(s, '10 usd taxi', { today: TODAY })
    expect(r.ok).toBe(true)
    expect(r.tx).toMatchObject({ currency: 'MDL', amount: 18000, orig: { amount: 1000, currency: 'USD' } })
    const d = parseQuick(s, '$10 taxi', { today: TODAY })
    expect(d.tx.amount).toBe(18000)
    const none = parseQuick(seeded(), '10 eur taxi', { today: TODAY })
    expect(none.ok).toBe(false)
    expect(none.missing).toMatch(/exchange rate/)
  })

  it('bad input saves nothing and says what is missing', () => {
    const s = seeded()
    expect(parseQuick(s, 'lunch', { today: TODAY })).toMatchObject({ ok: false, missing: expect.stringMatching(/amount/) })
    expect(parseQuick(s, '0 lunch', { today: TODAY }).ok).toBe(false)
    expect(parseQuick(s, '120 and 45 lunch', { today: TODAY })).toMatchObject({ ok: false, missing: expect.stringMatching(/Two amounts/) })
    expect(parseQuick(s, '+120 lunch -5', { today: TODAY }).ok).toBe(false)
    expect(parseQuick(s, '', { today: TODAY }).ok).toBe(false)
  })
})

describe('salary watch', () => {
  const cfg = { salary: { amount: 500000, currency: 'MDL', day: 10, account: 'card' } }
  const withSalary = (txs: unknown[] = []) => M.normalizeState({ settings: { ...cfg }, tx: txs })

  it('is off without settings', () => {
    expect(salaryStatus(M.normalizeState({ tx: [] }), TODAY)).toBeNull()
    expect(salaryStatus(M.normalizeState({ settings: { salary: { amount: 5000 } }, tx: [] }), TODAY)).toBeNull() // no pay day yet
  })

  it('is not late on pay day + 2, late on pay day + 3 with nothing matching', () => {
    const s = withSalary()
    expect(salaryStatus(s, '2026-11-09').late).toBe(false)
    expect(salaryStatus(s, '2026-11-12').late).toBe(false)
    const late = salaryStatus(s, '2026-11-13')
    expect(late.late).toBe(true)
    expect(late.dueDate).toBe('2026-11-10')
  })

  it('income within 20% of the amount, on any account, makes it not late; far off does not', () => {
    const near = withSalary([tx('2026-11-10', 430000, { type: 'income', category: 'work', account: 'wallet' })])
    expect(salaryStatus(near, TODAY).late).toBe(false)
    expect(salaryStatus(near, TODAY).received.id).toBeTruthy()
    const far = withSalary([tx('2026-11-10', 100000, { type: 'income', category: 'work' }), tx('2026-11-10', 700000, { type: 'income', category: 'work' })])
    expect(salaryStatus(far, TODAY).late).toBe(true)
    // A refund is not income, so it can not stand in for the salary.
    const refund = withSalary([tx('2026-11-10', 500000, { type: 'income', category: 'food', refund: true })])
    expect(salaryStatus(refund, TODAY).late).toBe(true)
  })

  it('a pay day of 31 falls on the last day of a short month', () => {
    const s = M.normalizeState({ settings: { salary: { amount: 500000, currency: 'MDL', day: 31 } }, tx: [] })
    expect(salaryStatus(s, '2026-11-30').dueDate).toBe('2026-11-30')
    expect(salaryStatus(s, '2026-11-30').late).toBe(false)
  })

  it('your real hourly pay: the salary that came in over the hours you set (or invoice hours)', () => {
    const s = M.normalizeState({
      settings: { ...cfg, workHour: { mode: 'auto', hoursPerMonth: 160, show: true } },
      tx: [tx('2026-11-10', 480000, { type: 'income', category: 'work' })],
    })
    expect(salaryStatus(s, TODAY).hourly).toMatchObject({ rate: 3000, hours: 160, source: 'set' }) // 4 800 / 160 h = 30 an hour
    const inv = M.normalizeState({
      settings: { ...cfg, workHour: { hoursPerMonth: 160 } },
      tx: [tx('2026-11-10', 480000, { type: 'income', category: 'work' })],
      invoices: [{ id: 'i1', date: '2026-11-01', paidDate: '2026-11-05', items: [{ hours: 100 }, { hours: 20 }] }],
    })
    expect(salaryStatus(inv, TODAY).hourly).toMatchObject({ rate: 4000, hours: 120, source: 'invoices' })
    // No hours set at all: no number (never a made-up one).
    const none = M.normalizeState({ settings: { ...cfg }, tx: [tx('2026-11-10', 480000, { type: 'income', category: 'work' })] })
    expect(salaryStatus(none, TODAY).hourly).toBeNull()
  })
})

describe('price memory', () => {
  it('shows the usual range and the last three for a payee, and flags 20% above the median', () => {
    const s = seeded()
    const m = priceMemory(s, 'Linella 99', { amountBase: 14000 })
    expect(m.payee).toBe('Linella')
    expect(m.line).toBe('Usually 141–200 at Linella (last 3: 141, 132, 148)')
    expect(m.high).toBe(false)
    const high = priceMemory(s, 'linella', { amountBase: 20000 })
    expect(high.high).toBe(true) // the median of the five is 148: over 177.6 is high
    expect(priceMemory(s, 'linella', { amountBase: 17700 }).high).toBe(false)
  })

  it('needs two earlier records, ignores itself on edit, and stores nothing', () => {
    const s = seeded()
    expect(priceMemory(s, 'Headphones')).toBeNull()
    expect(priceMemory(s, 'Brand new shop')).toBeNull()
    expect(priceMemory(s, '')).toBeNull()
    const before = JSON.stringify(s)
    const own = s.tx.find((t: any) => t.note === 'Linella #4411')
    expect(priceMemory(s, 'Linella', { excludeId: own.id }).n).toBe(4)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('ask money', () => {
  const s = seeded()
  it('how much on food in October?', () => {
    const r = askMoney(s, 'how much on food in October?', TODAY)
    expect(r.ok).toBe(true)
    expect(r.value).toBe(50000)
    expect(r.txs.map((t: any) => t.date).sort()).toEqual(['2026-10-03', '2026-10-05'])
    expect(r.search).toBe('cat:food from:2026-10-01 to:2026-10-31')
  })

  it('biggest expense this month', () => {
    const r = askMoney(s, 'biggest expense this month', TODAY)
    expect(r.value).toBe(60000)
    expect(r.detail).toMatch(/Cinema/)
    expect(r.txs[0].note).toBe('Cinema')
  })

  it('how much did I earn in 2026', () => {
    const r = askMoney(s, 'how much did I earn in 2026', TODAY)
    expect(r.value).toBe(500000) // the refund is not income
    expect(r.search).toContain('earned')
  })

  it('average spending per day last month', () => {
    const r = askMoney(s, 'average spending per day last month', TODAY)
    // October: 300 + 200 + 1 200 = 1 700 over 31 days.
    expect(r.value).toBe(Math.round(170000 / 31))
    expect(r.headline).toMatch(/\/ day/)
  })

  it('a refund lowers spending in its category', () => {
    const r = askMoney(s, 'how much on fun this month', TODAY)
    expect(r.value).toBe(60000 - 10000 + 9000 + 9500 + 8800)
  })

  it('a month with no year is the latest one, and a payee works', () => {
    expect(askMoney(s, 'spent in november', TODAY).value).toBe(14800 + 13200 + 14100 + 60000 - 10000 + 27300)
    expect(askMoney(s, 'how much at linella in november', TODAY).value).toBe(14800 + 13200 + 14100)
  })

  it('says what it can answer when it does not understand', () => {
    for (const q of ['what is the weather like', 'how much on spaceships in October', '', 'hello']) {
      const r = askMoney(s, q, TODAY)
      expect(r.ok).toBe(false)
      expect(r.text).toBe(CANT)
    }
  })
})

describe('the salary setting survives saving and syncing', () => {
  const withKey = () => {
    const s = seeded({}, { salary: { amount: 500000, currency: 'MDL', day: 10, account: 'card' } })
    s.settings.updatedAt = 6000
    return s
  }
  it('normalizeState and a reload keep it', () => {
    expect(M.normalizeState(JSON.parse(JSON.stringify(withKey()))).settings.salary).toEqual({ amount: 500000, currency: 'MDL', day: 10, account: 'card' })
    const store = new Map<string, string>()
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    fake.setItem('finance-helper.state', JSON.stringify(withKey()))
    expect(load(fake as unknown as Storage).settings.salary.day).toBe(10)
  })
  it('a sync round trip brings it to another device, and keeps ours when newer', () => {
    const cloud = toCloud(withKey(), 'dev-a', 7000)
    expect(cloud.data.settings.salary.amount).toBe(500000)
    const other = seeded()
    other.settings.updatedAt = 100
    expect(mergeStates(other, JSON.parse(JSON.stringify(cloud))).state.settings.salary.day).toBe(10)
    const mine = withKey()
    mine.settings.updatedAt = 9000
    const old = seeded()
    old.settings.updatedAt = 10
    expect(mergeStates(mine, JSON.parse(JSON.stringify(toCloud(old, 'dev-b', 20)))).state.settings.salary.account).toBe('card')
  })
})
