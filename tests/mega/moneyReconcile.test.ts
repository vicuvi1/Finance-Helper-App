// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyReconcile.test.ts) by scripts/port-mega-tests.mjs. 2 test(s) that need Life System code (./moneyHub) are left out.
// Money trust (Phase 1): monthly reconciliation and the full money export
// with its import back (a round trip with no duplicates and no lost field).
// Made-up data only; every date is passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as R from '../../js/reconcile.js'
// @ts-ignore
import * as X from '../../js/moneyexport.js'
// @ts-ignore
import { parseCSV } from '../../js/csv.js'
// @ts-ignore
import { workbook } from '../../js/xlsx.js'
// @ts-ignore
import { readWorkbook } from '../../js/xlsx-read.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import { countsAsSpending } from '../../js/catshare.js'
// @ts-ignore
import { safeToSpend } from '../../js/safespend.js'

let n = 0
const tx = (date: string, amount: number, extra: Record<string, unknown> = {}) => ({ id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date, category: 'food', account: 'card', note: '', createdAt: n, updatedAt: n, ...extra })

function state(extra: Record<string, unknown> = {}) {
  return M.normalizeState({
    settings: {
      currency: 'MDL',
      accounts: [
        { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 100000 },
        { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 20000 },
        { id: 'usd', name: 'Dollar card', kind: 'card', currency: 'USD', start: 5000 },
        { id: 'old', name: 'Old card', kind: 'card', currency: 'MDL', archived: true }
      ]
    },
    people: [{ id: 'p1', name: 'Acme', client: true }, { id: 'p2', name: 'Friend' }],
    rates: { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: 1 },
    tx: [],
    ...extra
  })
}

describe('reconciliation', () => {
  it('compares the real balance with the app\'s balance on that day and keeps the point', () => {
    const s = state({ tx: [tx('2026-10-02', 5000), tx('2026-10-20', 3000), tx('2026-11-05', 1000)] })
    const c = R.reconcileCheck(s, 'card', 90000, '2026-10-31')
    expect(c).toMatchObject({ app: 92000, real: 90000, diff: -2000, since: null })
    const p = R.addRecon(s, { account: 'card', date: '2026-10-31', real: 90000, id: 'rc1', now: 5 })
    expect(p).toMatchObject({ id: 'rc1', account: 'card', date: '2026-10-31', real: 90000, app: 92000, diff: -2000, adjustment: null })
    expect(R.lastRecon(s, 'card').id).toBe('rc1')
    // Records after the day are not in that day's balance.
    expect(R.appBalanceOn(s, 'card', '2026-11-30')).toBe(91000)
  })

  it('finds the causes: entries since the last point, likely duplicates, recurring items not logged, an entry of that amount', () => {
    const s = state({
      tx: [
        tx('2026-09-10', 4000, { note: 'groceries' }),
        tx('2026-10-03', 2500, { note: 'Taxi' }),
        tx('2026-10-04', 2500, { note: 'taxi' }),
        tx('2026-10-12', 777, { note: 'coffee' }),
        tx('2026-10-12', 777, { note: 'different thing' })
      ],
      recurring: [{ id: 'net', type: 'expense', every: 'month', start: '2026-09-15', amount: 15000, currency: 'MDL', account: 'card', category: 'home', note: 'Internet', lastDone: '2026-09-15' }]
    })
    R.addRecon(s, { account: 'card', date: '2026-09-30', real: 96000, id: 'rc0', now: 1 })
    const c = R.findCauses(s, 'card', '2026-10-31', 2500)
    expect(c.since).toBe('2026-09-30')
    expect(c.after.map((t: any) => t.note)).toEqual(['different thing', 'coffee', 'taxi', 'Taxi'])
    // "Taxi" and "taxi" a day apart are a pair; two 7,77 with different notes are not.
    expect(c.duplicates.map((p: any[]) => p.map((t) => t.note))).toEqual([['Taxi', 'taxi']])
    expect(c.missing.map((x: any) => [x.rule.note, x.date])).toEqual([['Internet', '2026-10-15']])
    expect(c.exact.map((t: any) => t.note).sort()).toEqual(['Taxi', 'taxi'])
  })

  // (left out here: needs Life System code)

  it('money found (the bank has more) is an income-side adjustment; the app\'s undo history also takes it back', () => {
    const s = state()
    const h = createHistory()
    h.reset(s)
    const p = R.addRecon(s, { account: 'wallet', date: '2026-10-31', real: 21000, id: 'rc1', now: 1 })
    h.record(s)
    R.adjustRecon(s, p, { id: 'adj1', now: 2 })
    h.record(s)
    expect(M.accountBalances(s).wallet).toBe(21000)
    expect(s.tx[0]).toMatchObject({ type: 'income', amount: 1000, category: 'other-in' })
    expect(M.monthSummary(s, '2026-10').income).toBe(0)
    h.undo(s, 5)
    expect(s.tx.length).toBe(0)
    expect(M.accountBalances(s).wallet).toBe(20000)
    expect(s.reconciliations[0].adjustment).toBeNull()
  })

  it('an adjustment in a dollar account keeps the dollar amount and that rate', () => {
    const s = state()
    const p = R.addRecon(s, { account: 'usd', date: '2026-10-31', real: 4000, id: 'rc1', now: 1 })
    const adj = R.adjustRecon(s, p, { id: 'a', rate: 17.6, now: 2 })
    expect(adj).toMatchObject({ amount: 1000, currency: 'USD', rate: 17.6, base: 17600 })
    expect(M.accountBalances(s).usd).toBe(4000)
  })

  // (left out here: needs Life System code)

  it('points sync between devices, a removed point stays removed, and old data without points still loads', () => {
    const a = state()
    const b = state()
    R.addRecon(a, { account: 'card', date: '2026-10-31', real: 100000, id: 'rcA', now: 10 })
    R.addRecon(b, { account: 'wallet', date: '2026-10-31', real: 20000, id: 'rcB', now: 11 })
    const merged = mergeStates(a, toCloud(b, 'dev2')).state
    expect(merged.reconciliations.map((r: any) => r.id).sort()).toEqual(['rcA', 'rcB'])
    R.removeRecon(merged, 'rcB', 20)
    const back = mergeStates(b, toCloud(merged, 'dev1')).state
    expect(back.reconciliations.map((r: any) => r.id)).toEqual(['rcA'])
    expect(M.normalizeState({ settings: {}, tx: [] }).reconciliations).toEqual([])
    expect(M.normalizeState(JSON.parse(JSON.stringify(merged))).reconciliations.length).toBe(1)
  })
})

// ---------- export and import back ----------

function richState() {
  n = 0
  const s = state({
    tx: [
      tx('2026-01-05', 125050, { type: 'income', category: 'work', person: 'p1', invoice: 'inv-1', note: 'Invoice #2026-01 #work' }),
      tx('2026-01-06', 1000, { account: 'usd', currency: 'USD', rate: 17.55, base: 17550, note: 'Cloud, "pro" plan' }),
      tx('2026-01-07', 2000, { currency: 'MDL', note: '-50 discount =SUM(A1) @home', orig: { amount: 100, currency: 'EUR', rate: 20 } }),
      tx('2026-01-08', 500, { loan: true, person: 'p2', note: 'lent\nsecond line' }),
      tx('2026-01-09', 1000, { account: 'usd', currency: 'USD', rate: 17.6, base: 17600, repricedFrom: { rate: 1, base: 1000, amount: 1000, currency: 'USD', at: 77 } }),
      { id: 'mv1', type: 'transfer', amount: 1000, currency: 'USD', rate: 17.6, base: 17600, toAmount: 17600, date: '2026-01-10', from: 'usd', to: 'card', note: 'Swap', createdAt: 90, updatedAt: 90 },
      tx('2026-01-11', 300, { note: 'Ștefan café 🍵', sub: undefined, splitOf: 'tX', source: 'telegram' })
    ],
    recurring: [{ id: 'r1', type: 'expense', every: 'month', start: '2026-01-01', amount: 1000, currency: 'USD', account: 'usd', category: 'subscriptions', note: 'Cloud' }],
    invoices: [{ id: 'inv-1', number: '2026-01', client: 'p1', date: '2026-01-02', currency: 'USD', items: [{ desc: 'Work', hours: 10, rate: 5000, amount: 50000 }], paidDate: '2026-01-05', paidTx: 't1' }],
    goals: [{ id: 'g1', name: 'Laptop', target: 2000000, saved: 0 }]
  })
  R.addRecon(s, { account: 'card', date: '2026-01-31', real: 100, id: 'rc1', now: 1 })
  return s
}

// What a record must keep through the round trip (updatedAt is "now" on import, so it syncs).
const strip = (t: any) => {
  const o = { ...t }
  delete o.updatedAt
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

describe('money export', () => {
  it('the transactions CSV has every field, UTF-8 with a BOM, and quotes what needs quoting', () => {
    const s = richState()
    const csv = X.csvText(X.txRows(s))
    expect(csv.startsWith('﻿')).toBe(true)
    const rows = parseCSV(csv)
    expect(rows[0]).toEqual(X.TX_HEADER)
    for (const h of ['Date', 'Account', 'Category', 'Amount', 'Currency', 'Base amount', 'Rate', 'Note', 'Tags', 'Client', 'Invoice ID', 'Repriced from']) expect(rows[0]).toContain(h)
    const row = (id: string) => rows.find((r: string[]) => r[0] === id)!
    const col = (name: string) => X.TX_HEADER.indexOf(name)
    expect(row('t1')[col('Amount')]).toBe('1250.50')
    expect(row('t1')[col('Tags')]).toBe('2026-01 work')
    expect(row('t1')[col('Client')]).toBe('Acme')
    expect(row('t1')[col('Invoice ID')]).toBe('inv-1')
    expect(row('t2')[col('Base amount')]).toBe('175.50')
    expect(row('t2')[col('Rate')]).toBe('17.55')
    expect(JSON.parse(row('t5')[col('Repriced from')])).toEqual({ rate: 1, base: 1000, amount: 1000, currency: 'USD', at: 77 })
    // A note that a spreadsheet would run as a formula is guarded.
    expect(row('t3')[col('Note')].startsWith("'-50")).toBe(true)
    expect(row('t6')[col('Note')]).toBe('Ștefan café 🍵')
    expect(JSON.parse(row('t6')[col('Other fields')])).toEqual({ splitOf: 'tX', source: 'telegram' })
  })

  it('accounts, invoices, clients, recurring items, goals and reconciliations are exported too, and the workbook reads back', async () => {
    const s = richState()
    expect(X.accountRows(s).length).toBe(1 + 4)
    expect(X.invoiceRows(s)[1].slice(0, 3)).toEqual(['inv-1', '2026-01', 'Acme'])
    expect(X.clientRows(s).map((r: string[]) => r[1])).toEqual(['Name', 'Acme'])
    expect(X.recurringRows(s)[1].slice(0, 5)).toEqual(['r1', 'expense', 'Cloud', '10.00', 'USD'])
    expect(X.goalRows(s)[1].slice(0, 3)).toEqual(['g1', 'Laptop', '20000.00'])
    expect(X.reconRows(s)[1].slice(0, 4)).toEqual(['rc1', 'Card', '2026-01-31', '1.00'])
    const sheets = X.workbookSheets(s)
    expect(sheets.map((x: any) => x.name)).toEqual(['Transactions', 'Accounts', 'Invoices', 'Clients', 'Recurring', 'Goals', 'Reconciliations'])
    const back = await readWorkbook(workbook(sheets))
    const t = back.find((x: any) => x.name === 'Transactions')
    expect(X.isMoneyExport(t.rows)).toBe(true)
    // Importing the workbook's transactions into the same data adds nothing.
    const p = X.previewImport(t.rows.map((r: any[]) => r.map((c) => (c == null ? '' : c))), s)
    expect(p.add.length).toBe(0)
    expect(p.duplicates.length).toBe(s.tx.length)
  })
})

describe('money import (the same CSV back)', () => {
  it('into the same data: every row is already here, nothing is added or changed', () => {
    const s = richState()
    const copy = JSON.stringify(s.tx)
    const p = X.previewImport(parseCSV(X.csvText(X.txRows(s))), s)
    expect(p.add).toEqual([])
    expect(p.duplicates.length).toBe(s.tx.length)
    expect(p.changed).toEqual([])
    expect(p.invalid).toEqual([])
    expect(X.applyImport(s, p)).toBe(0)
    expect(JSON.stringify(s.tx)).toBe(copy)
  })

  it('into a fresh copy with the same accounts: every record comes back exactly (id, rate, MDL value, repricedFrom, extra fields)', () => {
    const s = richState()
    const fresh = richState()
    fresh.tx = []
    const p = X.previewImport(parseCSV(X.csvText(X.txRows(s))), fresh, { now: 1e12 })
    expect(p.add.length).toBe(s.tx.length)
    X.applyImport(fresh, p, { ensurePerson: M.ensurePerson })
    const want = [...s.tx].sort((a: any, b: any) => a.id.localeCompare(b.id)).map(strip)
    const got = [...fresh.tx].sort((a: any, b: any) => a.id.localeCompare(b.id)).map(strip)
    expect(got).toEqual(want)
    for (const t of fresh.tx) expect(t.updatedAt).toBeGreaterThanOrEqual(1e12)
    // Same totals on both sides.
    expect(M.yearOverview(fresh, 2026)).toEqual(M.yearOverview(s, 2026))
    expect(M.accountBalances(fresh)).toEqual(M.accountBalances(s))
    // A second import of the same file adds nothing.
    expect(X.previewImport(parseCSV(X.csvText(X.txRows(s))), fresh).add).toEqual([])
  })

  it('never brings back a record deleted here, never overwrites one changed here, and skips the same record without an id', () => {
    const s = richState()
    const csv = X.csvText(X.txRows(s))
    M.removeTx(s, 't2', 50)
    s.tx.find((t: any) => t.id === 't4').amount = 999
    // A row typed by hand: no id, but the same as t6.
    const rows = parseCSV(csv)
    const t6 = rows.find((r: string[]) => r[0] === 't6')!.slice()
    t6[0] = ''
    rows.push(t6)
    const p = X.previewImport(rows, s)
    expect(p.deletedHere.map((x: any) => x.tx.id)).toEqual(['t2'])
    expect(p.changed.map((x: any) => x.tx.id)).toEqual(['t4'])
    expect(p.add).toEqual([])
    expect(s.tx.find((t: any) => t.id === 't4').amount).toBe(999)
  })

  it('rows it cannot place are listed with a reason, never guessed into another account', () => {
    const s = richState()
    const rows = parseCSV(X.csvText(X.txRows(s)))
    const col = (name: string) => X.TX_HEADER.indexOf(name)
    const r = rows[1].slice()
    r[0] = 'new-1'
    r[col('Account')] = 'Unknown bank'
    r[col('Account ID')] = 'nope'
    r[col('Note')] = 'brand new'
    rows.push(r)
    rows.push(['x', 'not a date', 'expense', '', '', '', '', '', '', '5'])
    const p = X.previewImport(rows, s)
    expect(p.invalid.map((x: any) => x.reason)).toEqual(['no account "Unknown bank" here', 'needs a date, a type and an amount'])
    expect(p.add).toEqual([])
  })

  it('a property: for random records the CSV round trip keeps every amount and adds no duplicate', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let x = seed
      const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
      const s = state()
      for (let i = 0; i < 30; i++) {
        const usd = rnd() < 0.3
        const amount = 1 + Math.floor(rnd() * 999999)
        const rate = usd ? Math.round((17 + rnd()) * 10000) / 10000 : 1
        s.tx.push(tx(`2026-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}`, amount, { type: rnd() < 0.3 ? 'income' : 'expense', category: 'other', account: usd ? 'usd' : 'card', currency: usd ? 'USD' : 'MDL', rate, base: Math.round(amount * rate), note: rnd() < 0.2 ? '' : `n ${Math.floor(rnd() * 5)}` }))
      }
      const fresh = state()
      const csv = X.csvText(X.txRows(s))
      const p = X.previewImport(parseCSV(csv), fresh)
      expect(p.add.length).toBe(30)
      X.applyImport(fresh, p)
      expect(fresh.tx.map(strip).sort((a: any, b: any) => a.id.localeCompare(b.id))).toEqual(s.tx.map(strip).sort((a: any, b: any) => a.id.localeCompare(b.id)))
      expect(X.previewImport(parseCSV(csv), fresh).add.length).toBe(0)
    }
  })
})
