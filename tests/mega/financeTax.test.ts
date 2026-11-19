// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeTax.test.ts) by scripts/port-mega-tests.mjs.
// Money v2 phase 3: tax tags, the yearly tax summary (per year, per book, per
// month), the profiles' rough estimates and that every new field survives the
// current (v3) sync untouched. Made-up data only; every date is passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore
import { taxTagOf, setTaxTag, undoTags, setCategoryTag, taxYear, profileFor, setProfile, setOverride, restoreTaxSettings, inCurrency, bookOf, tagSource } from '../../js/tax.js'
// @ts-ignore
import { PROFILES, DEFAULT_PROFILE } from '../../js/taxprofiles.js'
// @ts-ignore
import { keepOnEdit } from '../../js/screens/taxes.js'
// @ts-ignore
import { addReceiptId, removeReceiptId, receiptStatus, notInDrive } from '../../js/receipts.js'
import { FINANCE as SPEC } from './_life.js'

// Life's sync spec for Finance Helper, with its optional parts made plain for the tests.
const FINANCE = { share: SPEC.share!, fromShared: SPEC.fromShared!, merge: (mine: any, theirs: any) => SPEC.merge(mine, theirs, false) }

let n = 0
const tx = (date: string, amount: number, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, type: 'expense', amount, date, category: 'food', account: 'wallet', note: '', currency: 'MDL', rate: 1, base: amount, createdAt: n, updatedAt: n, ...extra })
const inc = (date: string, amount: number, extra: Record<string, unknown> = {}) => tx(date, amount, { type: 'income', category: 'work', ...extra })

function state(txs: any[], extra: Record<string, any> = {}) {
  const s = M.normalizeState({ tx: txs, ...extra })
  return s
}

describe('tax tags', () => {
  it('a record takes its category default; its own tag wins; "none" means no tag', () => {
    const a = inc('2026-03-01', 100000)
    const b = inc('2026-03-02', 50000, { tax: 'exempt' })
    const c = inc('2026-03-03', 20000, { tax: 'none' })
    const s = state([a, b, c])
    expect(taxTagOf(s, a)).toBeNull()
    setCategoryTag(s, 'work', 'taxable', 10)
    expect(taxTagOf(s, a)).toBe('taxable')
    expect(tagSource(s, a)).toBe('category')
    expect(taxTagOf(s, b)).toBe('exempt')
    expect(tagSource(s, b)).toBe('own')
    expect(taxTagOf(s, c)).toBeNull()
  })

  it('loans, moves, points buys and reconciliation adjustments never carry a tag', () => {
    const s = state([
      inc('2026-01-01', 1000, { loan: true, tax: 'taxable' }),
      tx('2026-01-02', 1000, { type: 'transfer', from: 'wallet', to: 'card', tax: 'deductible' }),
      tx('2026-01-03', 1000, { id: 'life-reward-1', tax: 'deductible' }),
      tx('2026-01-04', 1000, { reconcile: { at: 1 }, tax: 'deductible' }),
    ])
    for (const t of s.tx) expect(taxTagOf(s, t)).toBeNull()
    expect(taxYear(s, 2026).rows).toHaveLength(0)
  })

  it('a tag that does not fit the record type is ignored and skipped in bulk', () => {
    const e = tx('2026-02-01', 3000, { tax: 'taxable' })
    const s = state([e, inc('2026-02-02', 5000)])
    expect(taxTagOf(s, s.tx[0])).toBeNull()
    const r = setTaxTag(s, s.tx.map((t: any) => t.id), 'deductible', 50)
    expect(r).toMatchObject({ changed: 1, skipped: 1 })
    expect(setCategoryTag(s, 'food', 'taxable')).toBeNull()
  })

  it('bulk set touches each changed record and undo puts the old values back exactly', () => {
    const s = state([tx('2026-04-01', 1000), tx('2026-04-02', 2000, { tax: 'vat' }), tx('2026-04-03', 3000, { tax: 'none' })])
    const ids = s.tx.map((t: any) => t.id)
    const r = setTaxTag(s, ids, 'deductible', 999)
    expect(r.changed).toBe(3)
    expect(s.tx.every((t: any) => t.tax === 'deductible' && t.updatedAt === 999)).toBe(true)
    undoTags(s, r.before, 1000)
    expect(s.tx.map((t: any) => t.tax)).toEqual([undefined, 'vat', 'none'])
    expect('tax' in s.tx[0]).toBe(false)
    expect(s.tx.every((t: any) => t.updatedAt === 1000)).toBe(true)
    // 'auto' removes the field: back to the category default.
    setTaxTag(s, [ids[1]], 'auto', 1001)
    expect('tax' in s.tx[1]).toBe(false)
  })

  it('tags never change any money total', () => {
    const list = [inc('2026-05-01', 900000), tx('2026-05-02', 12345), tx('2026-05-03', 67890, { category: 'learning' }), inc('2026-05-04', 4000, { category: 'gift-in' })]
    const s = state(list)
    const before = M.report(s, '2026-01-01', '2026-12-31')
    setCategoryTag(s, 'work', 'taxable')
    setCategoryTag(s, 'learning', 'deductible')
    setTaxTag(s, [s.tx[1].id], 'vat')
    const after = M.report(s, '2026-01-01', '2026-12-31')
    expect([after.income, after.expense, after.net]).toEqual([before.income, before.expense, before.net])
  })
})

describe('the yearly tax summary', () => {
  const build = () => state([
    inc('2025-12-31', 111100, { tax: 'taxable' }),
    inc('2026-01-15', 1000000, { tax: 'taxable', category: 'work' }),
    inc('2026-02-10', 500000, { tax: 'taxable', category: 'side', account: 'biz' }),
    inc('2026-02-11', 30000, { tax: 'exempt', category: 'gift-in' }),
    tx('2026-02-20', 120000, { tax: 'deductible', category: 'learning', account: 'biz' }),
    tx('2026-03-05', 80000, { tax: 'deductible', category: 'subscriptions', book: 'business' }),
    tx('2026-03-06', 16000, { tax: 'vat' }),
    inc('2026-03-07', 20000, { tax: 'vat' }),
    tx('2026-03-08', 5000),
    inc('2026-04-01', 7000),
    inc('2027-01-02', 99900, { tax: 'taxable' }),
  ], { settings: { accounts: [{ id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL' }, { id: 'biz', name: 'Biz', kind: 'business', currency: 'MDL', book: 'business' }] } })

  it('totals by tag for one year only', () => {
    const t = taxYear(build(), 2026)
    expect(t.totals).toMatchObject({ taxable: 1500000, exempt: 30000, deductible: 200000, vatIn: 20000, vatOut: 16000, profit: 1300000 })
    expect(t.rows).toHaveLength(7)
    expect(t.rows.map((r: any) => r.date)).toEqual([...t.rows.map((r: any) => r.date)].sort())
    expect(t.untagged).toEqual({ income: 1, expense: 1 })
    expect(taxYear(build(), 2025).totals.taxable).toBe(111100)
  })

  it('income by source and deductible costs by category', () => {
    const t = taxYear(build(), 2026)
    expect(t.incomeBySource.map((g: any) => [g.name, g.total])).toEqual([['Work', 1000000], ['Side jobs', 500000]])
    expect(t.deductibleByCategory.map((g: any) => [g.name, g.total])).toEqual([['Learning & tools', 120000], ['Subscriptions', 80000]])
  })

  it('per book: the record\'s book, else its account\'s, else personal', () => {
    const s = build()
    expect(bookOf(s, s.tx.find((t: any) => t.account === 'biz'))).toBe('business')
    const t = taxYear(s, 2026)
    const by = Object.fromEntries(t.books.map((b: any) => [b.book, b]))
    expect(t.books[0].book).toBe('personal')
    expect(by.business).toMatchObject({ taxable: 500000, deductible: 200000, profit: 300000 })
    expect(by.personal).toMatchObject({ taxable: 1000000, exempt: 30000, deductible: 0 })
    const sum = (k: string) => t.books.reduce((a: number, b: any) => a + b[k], 0)
    for (const k of ['taxable', 'exempt', 'deductible', 'vatIn', 'vatOut']) expect(sum(k)).toBe(t.totals[k])
  })

  it('month by month adds up to the year', () => {
    const t = taxYear(build(), 2026)
    expect(t.months).toHaveLength(12)
    expect(t.months[0]).toMatchObject({ key: '2026-01', taxable: 1000000 })
    expect(t.months[1]).toMatchObject({ taxable: 500000, exempt: 30000, deductible: 120000 })
    expect(t.months.reduce((a: number, m: any) => a + m.taxable, 0)).toBe(t.totals.taxable)
  })

  it('a record in another currency counts at its own day\'s rate', () => {
    const s = state([inc('2026-06-01', 10000, { currency: 'USD', rate: 17.5, base: 175000, tax: 'taxable' })])
    expect(taxYear(s, 2026).totals.taxable).toBe(175000)
  })
})

describe('profiles and the estimate (not tax advice)', () => {
  const s0 = () => state([inc('2026-01-10', 4000000, { tax: 'taxable' }), tx('2026-02-01', 1000000, { tax: 'deductible' })])

  it('the default is the individual entrepreneur: 12% of taxable income minus deductible costs', () => {
    expect(DEFAULT_PROFILE).toBe('entrepreneur')
    const t = taxYear(s0(), 2026)
    expect(t.profile.id).toBe('entrepreneur')
    expect(t.estimate).toMatchObject({ income: 4000000, costs: 1000000, base: 3000000, bp: 1200, tax: 360000 })
    expect(t.deadlines[0]).toEqual({ date: '2027-03-25', label: 'Income tax declaration' })
  })

  it('individual: the exemption comes off, and is dropped at the cap', () => {
    const s = s0()
    setProfile(s, 'individual', 5)
    const t = taxYear(s, 2026)
    expect(t.estimate).toMatchObject({ exemption: 2970000, base: 1030000, tax: 123600 })
    expect(t.profile.warnings.some((w: string) => /not confirmed/.test(w))).toBe(false)
    expect(t.profile.unconfirmed).toEqual([])
    expect(t.profile.sources.join(' ')).toMatch(/monitorul\.fisc\.md.*29,700/)
    s.tx[0].base = s.tx[0].amount = 36000000
    expect(taxYear(s, 2026).estimate).toMatchObject({ exemption: 0, base: 36000000, tax: 4320000 })
  })

  it('IT Park: 7% of sales income, costs do not count', () => {
    const s = s0()
    setProfile(s, 'itpark')
    expect(taxYear(s, 2026).estimate).toMatchObject({ base: 4000000, bp: 700, tax: 280000 })
  })

  it('"not set" shows totals only, no estimate', () => {
    const s = s0()
    setProfile(s, 'none')
    const t = taxYear(s, 2026)
    expect(t.estimate).toBeNull()
    expect(t.totals.taxable).toBe(4000000)
  })

  it('your own number wins, is listed, and goes back; bad numbers are refused', () => {
    const s = s0()
    expect(setOverride(s, 2026, 'pitBp', 1000, 7)).toBe(true)
    expect(setOverride(s, 2026, 'pitBp', 12.5)).toBe(false)
    expect(setOverride(s, 2026, 'pitBp', 20000)).toBe(false)
    expect(setOverride(s, 2026, 'nope', 1)).toBe(false)
    const p = profileFor(s, 2026)
    expect(p.numbers.pitBp).toBe(1000)
    expect(p.overridden).toEqual(['pitBp'])
    expect(taxYear(s, 2026).estimate.tax).toBe(300000)
    expect(profileFor(s, 2027).numbers.pitBp).toBe(1200)
    setOverride(s, 2026, 'pitBp', null)
    expect(s.settings.tax.overrides['2026']).toBeUndefined()
  })

  it('another year uses the newest numbers and says so', () => {
    const p = profileFor(s0(), 2028)
    expect(p.numbersYear).toBe(2026)
    expect(p.warnings[0]).toMatch(/2026 numbers: check them for 2028/)
  })

  it('every profile is dated and sourced; stored numbers are integers', () => {
    for (const p of Object.values(PROFILES) as any[]) for (const y of Object.values(p.years) as any[]) {
      expect(y.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (p.id !== 'none') expect(y.sources.length).toBeGreaterThan(0)
      for (const k of ['pitBp', 'exemption', 'exemptionCap', 'turnoverBp']) if (k in y) expect(Number.isSafeInteger(y[k])).toBe(true)
    }
    const t = taxYear(s0(), 2026)
    for (const v of Object.values(t.estimate)) if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true)
  })

  it('a profile change can be undone exactly', () => {
    const s = s0()
    const r = setProfile(s, 'itpark', 3)
    restoreTaxSettings(s, r.old, 4)
    expect(s.settings.tax).toBeUndefined()
  })

  it('totals in USD or EUR at today\'s rate; never 1:1 without a rate', () => {
    const s = s0()
    s.rates = { usd: { USD: 1, MDL: 17.5, EUR: 0.875 }, crypto: {}, history: {}, fetchedAt: 1 }
    expect(inCurrency(s, 175000, 'USD')).toBe(10000)
    expect(inCurrency(s, 175000, 'EUR')).toBe(8750)
    expect(inCurrency(s, 175000, 'MDL')).toBe(175000)
    s.rates = null
    expect(inCurrency(s, 175000, 'EUR')).toBeNull()
  })
})

describe('receipt ids on records', () => {
  it('adding and removing touches the record; status comes from Life\'s index', () => {
    const t: any = tx('2026-07-01', 1000)
    expect(addReceiptId(t, 'r-abc123', 5)).toBe(true)
    expect(addReceiptId(t, 'r-abc123', 6)).toBe(false)
    expect(t).toMatchObject({ receipts: ['r-abc123'], updatedAt: 5 })
    const s = state([t])
    expect(notInDrive(s, { 'r-abc123': { name: 'x' } })).toBe(1)
    expect(receiptStatus({ 'r-abc123': { driveId: 'd1' } }, 'r-abc123')).toBe('drive')
    expect(notInDrive(s, { 'r-abc123': { driveId: 'd1' } })).toBe(0)
    expect(receiptStatus({}, 'r-zzz')).toBe('unknown')
    expect(removeReceiptId(t, 'r-abc123', 9)).toBe(true)
    expect('receipts' in t).toBe(false)
  })

  it('editing a record in the sheet keeps its tax tag and receipts', () => {
    const s = state([tx('2026-07-02', 1000, { tax: 'deductible', receipts: ['r-keep1'] })])
    expect(keepOnEdit(s, s.tx[0].id)).toEqual({ tax: 'deductible', receipts: ['r-keep1'] })
    expect(keepOnEdit(s, 'nope')).toEqual({})
  })
})

describe('the new fields survive the current (v3) sync', () => {
  const full = () => {
    const s = state([inc('2026-08-01', 10000, { tax: 'taxable' }), tx('2026-08-02', 2000, { tax: 'deductible', receipts: ['r-one111', 'r-two222'] })])
    setCategoryTag(s, 'work', 'taxable', 100)
    setProfile(s, 'individual', 101)
    setOverride(s, 2026, 'exemption', 3150000, 102)
    return s
  }
  const fields = (s: any) => ({ tx: s.tx.map((t: any) => [t.id, t.tax, t.receipts]), cat: M.category(s, 'work').tax, tax: s.settings.tax })

  it('through Life\'s sync (share → shared copy → merge) without loss', () => {
    const a = full()
    const shared = JSON.parse(JSON.stringify(FINANCE.share(a)))
    const b = FINANCE.fromShared(shared)
    expect(fields(b)).toEqual(fields(a))
    const empty = state([])
    expect(fields(FINANCE.merge(JSON.parse(JSON.stringify(empty)), shared))).toEqual(fields(a))
  })

  it('through Finance\'s own merge and the bot\'s save (toCloud of normalizeState)', () => {
    const a = full()
    const bot = M.normalizeState({ ...JSON.parse(JSON.stringify(toCloud(M.normalizeState(a), '').data)), version: M.SCHEMA_VERSION })
    expect(fields(bot)).toEqual(fields(a))
    const merged = mergeStates(state([]), { app: 'finance-helper', schema: M.SCHEMA_VERSION, savedAt: 0, data: toCloud(a, '').data }).state
    expect(fields(merged)).toEqual(fields(a))
  })

  it('an old client that edits another setting keeps settings.tax; a newer tag on a record wins', () => {
    const a = full()
    const old = FINANCE.fromShared(JSON.parse(JSON.stringify(FINANCE.share(a))))
    old.settings.smallPurchase = 5000
    old.settings.updatedAt = 999999
    old.tx[1].note = 'edited on the old device'
    old.tx[1].updatedAt = 999999
    const back = FINANCE.merge(a, JSON.parse(JSON.stringify(FINANCE.share(old))))
    expect(back.settings.tax).toEqual(a.settings.tax)
    expect(back.settings.smallPurchase).toBe(5000)
    expect(back.tx.find((t: any) => t.id === a.tx[1].id)).toMatchObject({ note: 'edited on the old device', tax: 'deductible', receipts: ['r-one111', 'r-two222'] })
    // A tag set later on this device wins over the older copy.
    setTaxTag(a, [a.tx[0].id], 'exempt', 2000000)
    expect(FINANCE.merge(old, JSON.parse(JSON.stringify(FINANCE.share(a)))).tx.find((t: any) => t.id === a.tx[0].id).tax).toBe('exempt')
  })

  it('no new top-level keys in the Finance data', () => {
    const before = Object.keys(toCloud(state([]), '').data).sort()
    expect(Object.keys(toCloud(full(), '').data).sort()).toEqual(before)
  })
})
