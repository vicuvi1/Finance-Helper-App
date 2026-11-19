// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyReality.test.ts) by scripts/port-mega-tests.mjs. 1 test(s) that need Life System code (@core/checkupNotice) are left out.
// Reality check (2026-11-19): the every-2-weeks schedule and its reminders, the difference across
// currencies, the causes shown before any adjustment, the one adjustment record (honest totals, undoable),
// the history and accuracy, and the real-data guard for incoming records. Made-up data; the clock is pinned.
import { afterEach, beforeEach, describe, expect, it, vi } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as C from '../../js/checkup.js'
// @ts-ignore
import * as RC from '../../js/reality.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'
import { FINANCE as SPEC } from './_life.js'

const NOW = Date.parse('2026-11-18T12:00:00')
const DAY = 864e5
let n = 0
const tx = (amount: number, over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: 1, updatedAt: 1, ...over })
const mk = (list: any[] = [], extra: any = {}) =>
  M.normalizeState({
    settings: {
      currency: 'MDL',
      accounts: [
        { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 100000 },
        { id: 'cash', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 50000 },
        { id: 'eur', name: 'Euro', kind: 'card', currency: 'EUR', start: 10000 },
      ],
      ...extra.settings,
    },
    tx: list,
    recurring: extra.recurring || [],
  })
const checkAll = (s: any, day: string) => { for (const a of s.settings.accounts) C.applyCheckup(s, a.id, null, day) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => vi.useRealTimers())

describe('schedule', () => {
  it('every 2 weeks on Sunday by default, from the chosen time; a check counts for its cycle', () => {
    const s = mk()
    // Never checked: due now (the last Sunday, 15 Nov).
    expect(C.checkupDue(s, '2026-11-18')).toMatchObject({ cycle: '2026-11-15', due: '2026-11-15', overdue: true })
    checkAll(s, '2026-11-15')
    expect(C.checkupDue(s, '2026-11-18')).toBeNull()
    expect(C.nextCheck(s, '2026-11-18')).toBe('2026-11-29')
    expect(C.checkupDue(s, '2026-11-28')).toBeNull()
    // Due on 29 Nov from 19:00 (the default time); the card shows from the day.
    expect(C.checkupDue(s, '2026-11-29', '18:59')).toBeNull()
    expect(C.checkupDue(s, '2026-11-29', '19:00')).toMatchObject({ cycle: '2026-11-29', overdue: false })
    expect(C.checkupCard(s, '2026-11-29')).not.toBeNull()
    expect(C.checkupDue(s, '2026-12-01').overdue).toBe(true)
    // Skipped: the next cycle starts 2 weeks later (the reminder key moves on).
    expect(C.checkupDue(s, '2026-12-12').cycle).toBe('2026-11-29')
    expect(C.checkupDue(s, '2026-12-13').cycle).toBe('2026-12-13')
    // A check a day early still counts for that cycle.
    checkAll(s, '2026-12-12')
    expect(C.nextCheck(s, '2026-12-12')).toBe('2026-12-27')
  })
  it('weekly, monthly, another weekday and time; one account checked more often', () => {
    const s = mk()
    checkAll(s, '2026-11-15')
    C.setCheckup(s, { every: 'week', weekday: 3, time: '08:30' }) // Wednesdays
    expect(C.nextCheck(s, '2026-11-16')).toBe('2026-11-18')
    expect(C.checkupDue(s, '2026-11-18', '08:00')).toBeNull()
    expect(C.checkupDue(s, '2026-11-18', '08:30')).not.toBeNull()
    C.setCheckup(s, { every: 'month', day: 5 })
    expect(C.nextCheck(s, '2026-11-16')).toBe('2026-12-05')
    C.setCheckup(s, { every: '2weeks', weekday: 0 })
    RC.setAcctEvery(s, 'cash', 'week')
    const due = C.checkupDue(s, '2026-11-22')
    expect(due.left.map((x: any) => x.account.id)).toEqual(['cash'])
    RC.setAcctEvery(s, 'cash', null)
    expect(C.checkupDue(s, '2026-11-22')).toBeNull()
    C.setCheckup(s, { every: 'yearly', time: '25:00' }) // ignored
    expect(C.checkupConfig(s)).toMatchObject({ every: '2weeks', time: '08:30' })
  })
  // (left out here: needs Life System code)
})

describe('the window: difference and causes', () => {
  it('the difference in the account currency and its value in MDL', () => {
    const s = mk([tx(2000, { account: 'eur', currency: 'EUR', rate: 20, base: 40000, date: '2026-11-10' })]) // 100.00 - 20.00 = 80.00 EUR
    const d = RC.rowDiff(s, 'eur', 7500, '2026-11-18', 19.5)
    expect(d).toMatchObject({ currency: 'EUR', app: 8000, real: 7500, diff: -500, diffBase: -9750, appBase: 156000, realBase: 146250 })
    expect(RC.rowDiff(s, 'card', 100000, '2026-11-18', 0)).toMatchObject({ diff: 0, rate: 1, diffBase: 0 })
    expect(RC.rowDiff(s, 'eur', 7500, '2026-11-18', 0).diffBase).toBeNull() // no rate: no made-up value
  })
  it('suggests To confirm, duplicates, exact amounts, future dates, other currencies and pending transfers first', () => {
    const rent = { id: 'r1', type: 'expense', amount: 30000, currency: 'MDL', account: 'card', category: 'home', note: 'Internet', every: 'month', start: '2026-11-10', lastDone: null, auto: false, paused: false, updatedAt: 1 }
    const s = mk([
      tx(4500, { id: 'd1', note: 'Pizza', date: '2026-11-12' }),
      tx(4500, { id: 'd2', note: 'Pizza', date: '2026-11-12', source: 'telegram' }),
      tx(7000, { id: 'fut', note: 'Taxi', date: '2026-12-11', source: 'telegram' }),
      tx(1500, { id: 'usd', note: 'App', currency: 'USD', date: '2026-11-14' }),
      { id: 'tr', type: 'transfer', amount: 20000, currency: 'MDL', rate: 1, base: 20000, date: '2026-11-20', from: 'card', to: 'cash', createdAt: 1, updatedAt: 1 },
    ], { recurring: [rent] })
    const causes = RC.realityCauses(s, 'card', '2026-11-18', -30000)
    const kinds = causes.map((c: any) => c.kind)
    expect(kinds).toEqual(expect.arrayContaining(['confirm', 'dupe', 'future', 'currency', 'transfer']))
    // The To confirm item explains it exactly, so it comes first.
    expect(causes[0]).toMatchObject({ kind: 'confirm', fits: true, effect: -30000 })
    expect(causes.find((c: any) => c.kind === 'dupe')).toMatchObject({ effect: 4500 })
    expect(causes.find((c: any) => c.kind === 'future').tx.id).toBe('fut')
    // Exactly the difference: an expense of 45.00 when the bank has 45.00 more.
    expect(RC.realityCauses(s, 'card', '2026-11-18', 4500).some((c: any) => c.kind === 'exact' && c.fits)).toBe(true)
    expect(RC.realityCauses(s, 'card', '2026-11-18', 0)).toEqual([])
  })
  it('"probably forgotten": a category paid in 3 of the last 4 months with nothing lately', () => {
    const list = ['2026-07-03', '2026-08-04', '2026-10-02'].map((d) => tx(12000, { category: 'fun', date: d }))
    const s = mk([...list, tx(500, { category: 'fun', date: '2026-09-09' })])
    const f = RC.realityCauses(s, 'card', '2026-11-18', -15000).find((c: any) => c.kind === 'forgot')
    expect(f).toMatchObject({ category: 'fun', effect: -12000 })
    // The bank has more: no forgotten spending is suggested.
    expect(RC.realityCauses(s, 'card', '2026-11-18', 15000).some((c: any) => c.kind === 'forgot')).toBe(false)
  })
})

describe('fix: matches and one honest adjustment', () => {
  it('the adjustment is notSpending / notIncome, noted "Reality check 18 Nov", in the history, and Undo takes all of it back', () => {
    const s = mk([tx(20000, { date: '2026-11-02' })]) // card 800.00
    const h = createHistory()
    h.reset(s)
    const r = RC.finishAccount(s, 'card', 75000, '2026-11-18', { checkId: 'rc-1', now: NOW })
    expect(r.tx).toMatchObject({ type: 'expense', amount: 5000, notSpending: true, checkup: true, reality: 'rc-1', note: 'Reality check 18 Nov', date: '2026-11-18' })
    expect(r.row).toMatchObject({ account: 'card', app: 80000, real: 75000, first: -5000, base: -5000, left: -5000, how: 'adjusted', adj: r.tx.id })
    expect(M.accountBalances(s).card).toBe(75000)
    const up = RC.finishAccount(s, 'cash', 60000, '2026-11-18', { checkId: 'rc-1', now: NOW })
    expect(up.tx).toMatchObject({ type: 'income', amount: 10000, notIncome: true })
    expect(s.settings.cashCountLast).toBe('2026-11-18') // the weekly cash count is answered too
    const rep = M.report(s, '2026-11-01', '2026-11-30')
    expect([rep.expense, rep.income]).toEqual([20000, 0])
    expect(RC.historyOf(s)).toHaveLength(1)
    expect(RC.historyOf(s)[0].rows).toHaveLength(2)
    h.record(s)
    h.undo(s)
    expect(s.tx.filter((t: any) => t.checkup)).toHaveLength(0)
    expect(RC.historyOf(s)).toHaveLength(0)
    expect(s.settings.checkupLast?.card).toBeUndefined()
  })
  it('"Matches" saves only the date; fixing a cause first is remembered as fixed', () => {
    const rent = { id: 'r1', type: 'expense', amount: 30000, currency: 'MDL', account: 'card', category: 'home', note: 'Internet', every: 'month', start: '2026-11-10', lastDone: null, auto: false, paused: false, updatedAt: 1 }
    const s = mk([], { recurring: [rent] })
    const m = RC.finishAccount(s, 'eur', null, '2026-11-18', { checkId: 'rc-2', rate: 20 })
    expect(m.tx).toBeNull()
    expect(m.row).toMatchObject({ how: 'match', first: 0 })
    // The bank shows 700.00, the app 1000.00: confirming the 300.00 Internet bill explains it.
    const first = RC.rowDiff(s, 'card', 70000, '2026-11-18').diff
    expect(first).toBe(-30000)
    s.tx.push({ id: 'rec-r1-2026-11-10', type: 'expense', amount: 30000, currency: 'MDL', rate: 1, base: 30000, date: '2026-11-10', account: 'card', category: 'home', recurring: 'r1', createdAt: 2, updatedAt: 2 })
    const f = RC.finishAccount(s, 'card', 70000, '2026-11-18', { checkId: 'rc-2', first, firstBase: first })
    expect(f.tx).toBeNull()
    expect(f.row).toMatchObject({ how: 'fixed', first: -30000, left: 0 })
  })
})

describe('adapt: history, accuracy, drift and habits', () => {
  const entry = (id: string, date: string, rows: any[]) => ({ id, date, updatedAt: 1, rows })
  it('the streak counts checks in a row within 50 MDL; drifting accounts get a habit tip', () => {
    const s = mk()
    s.settings.realityHistory = [
      entry('a', '2026-10-04', [{ account: 'card', base: -20000 }, { account: 'cash', base: -9000 }]),
      entry('b', '2026-10-18', [{ account: 'card', base: -15000 }, { account: 'cash', base: 0 }]),
      entry('c', '2026-11-01', [{ account: 'card', base: 2000 }, { account: 'cash', base: -4000 }]),
      entry('d', '2026-11-15', [{ account: 'card', base: 0 }, { account: 'cash', base: 4999 }]),
    ]
    expect(RC.accuracy(s)).toMatchObject({ streak: 2, checks: 4 })
    const d = RC.drift(s)
    expect(d[0]).toMatchObject({ account: 'card', misses: 2, total: 35000 })
    expect(d[1]).toMatchObject({ account: 'cash', misses: 1 })
    // Card was off only in its 3rd and 4th newest checks: no tip yet. Two recent misses on the wallet give one.
    expect(RC.habitTips(s)).toEqual([])
    s.settings.realityHistory.push(entry('e', '2026-11-29', [{ account: 'cash', base: -8000 }]), entry('f', '2026-12-13', [{ account: 'cash', base: -7000 }]))
    s.settings.cashCountOn = false
    expect(RC.habitTips(s)).toEqual([{ account: 'cash', kind: 'cash', act: 'cash-count-on' }, { account: 'cash', kind: 'weekly', act: 'acct-weekly' }])
    expect(RC.accuracy(s).streak).toBe(0)
  })
  it('the history and the new settings keys survive Finance sync, Life sync and the cloud copy; entries merge by id', () => {
    const a = mk()
    const b = mk()
    C.setCheckup(a, { every: 'week', weekday: 2, time: '07:45' })
    RC.setAcctEvery(a, 'cash', 'week')
    RC.saveRow(a, 'rc-a', '2026-11-15', { account: 'card', base: 0, first: 0, how: 'match' }, 10)
    RC.saveRow(b, 'rc-b', '2026-11-16', { account: 'eur', base: 100, first: 5, how: 'adjusted' }, 20)
    const merged = mergeStates(a, toCloud(b, 'b')).state
    expect(RC.historyOf(merged).map((e: any) => e.id)).toEqual(['rc-b', 'rc-a'])
    const keys = (s: any) => [s.settings.checkupEvery, s.settings.checkupWeekday, s.settings.checkupTime, s.settings.checkupAcctEvery, s.settings.realityHistory?.length]
    const shared = JSON.parse(JSON.stringify(SPEC.share!(a)))
    expect(keys(SPEC.fromShared!(shared))).toEqual(keys(a))
    const cloud = JSON.parse(JSON.stringify(toCloud(M.normalizeState(a), '').data))
    expect(keys(M.normalizeState({ ...cloud, version: M.SCHEMA_VERSION }))).toEqual(['week', 2, '07:45', { cash: 'week' }, 1])
  })
})

describe('real-data guard', () => {
  const recent = (over: any) => tx(over.amount ?? 10000, { createdAt: NOW - DAY, updatedAt: NOW - DAY, ...over })
  it('flags far-off amounts, odd dates, wrong currency, exact duplicates and income with no source; nothing is changed', () => {
    const usual = Array.from({ length: 8 }, (_, i) => tx(10000 + i * 100, { date: `2026-10-${String(i + 10).padStart(2, '0')}` }))
    const s = mk([
      ...usual,
      recent({ id: 'big', amount: 950000, note: 'Groceries', source: 'telegram' }),
      recent({ id: 'fut', date: '2027-01-02', note: 'Bus' }),
      recent({ id: 'old', date: '2026-08-01', note: 'Coffee', source: 'capture' }),
      recent({ id: 'cur', currency: 'USD', note: 'App store' }),
      recent({ id: 'x1', note: 'Lunch', date: '2026-11-17', createdAt: NOW - 2 * DAY }),
      recent({ id: 'x2', note: 'lunch ', date: '2026-11-17' }),
      recent({ id: 'inc', type: 'income', category: 'other-in', amount: 50000 }),
      recent({ id: 'ok', note: 'Bread', amount: 1200 }),
      tx(9000000, { id: 'oldbig', date: '2026-01-02', createdAt: NOW - 300 * DAY }), // not new: never flagged
    ])
    const before = JSON.stringify(s.tx)
    const flags = RC.guardFlags(s, '2026-11-18', { now: NOW })
    const codes = Object.fromEntries(flags.map((f: any) => [f.tx.id, f.reasons.map((r: any) => r.code)]))
    expect(codes.big).toContain('range')
    expect(codes.fut).toEqual(['future'])
    expect(codes.old).toEqual(['old'])
    expect(codes.cur).toEqual(['currency'])
    expect(codes.x2).toEqual(['dupe'])
    expect(codes.x1).toBeUndefined()
    expect(codes.inc).toEqual(['nosource'])
    expect(codes.ok).toBeUndefined()
    expect(codes.oldbig).toBeUndefined()
    expect(JSON.stringify(s.tx)).toBe(before)
    // "It's right": one normal edit (a later updatedAt, so it syncs); the record leaves the list.
    expect(RC.markRight(s, ['big'], NOW)).toBe(1)
    expect(s.tx.find((t: any) => t.id === 'big')).toMatchObject({ guardOk: true, updatedAt: NOW })
    expect(RC.guardFlags(s, '2026-11-18', { now: NOW }).some((f: any) => f.tx.id === 'big')).toBe(false)
    // Adjustments made by the app itself are never flagged.
    RC.finishAccount(s, 'card', 1, '2026-11-18', { checkId: 'rc-9', now: NOW })
    expect(RC.guardFlags(s, '2026-11-18', { now: NOW }).some((f: any) => f.tx.checkup)).toBe(false)
  })
})
