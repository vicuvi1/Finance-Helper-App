// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/moneyIncomeSources.test.ts) by scripts/port-mega-tests.mjs. 1 test(s) that need Life System code (@core/salaryNotice) are left out.
// Income sources (Job 1, Job 2 ...): the list, totals, quick add "@job2", suggestions, archive,
// bulk set with Undo, search, Ask, the salary watch per source and sync. Made-up data only; the clock is passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as IS from '../../js/incomesources.js'
// @ts-ignore
import { parseQuick } from '../../js/quickadd.js'
// @ts-ignore
import { searchTx } from '../../js/search.js'
// @ts-ignore
import { queryTerms } from '../../js/searchchips.js'
// @ts-ignore
import * as Bulk from '../../js/bulk.js'
// @ts-ignore
import { createHistory, snapshot, diff } from '../../js/history.js'
// @ts-ignore
import { LOGGED } from '../../js/changelog.js'
// @ts-ignore
import { askMoney } from '../../js/ask.js'
// @ts-ignore
import { monthReview } from '../../js/monthreview.js'
// @ts-ignore
import { sourceWatch, sourceAlerts } from '../../js/salary.js'
// @ts-ignore
import { toCloud, mergeStates } from '../../js/sync.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 100000
  return { id: `t${++n}`, type: 'income', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'work', note: '', createdAt: n, updatedAt: n, ...over }
}
const money = (list: any[] = []) =>
  M.normalizeState({
    settings: {
      currency: 'MDL',
      accounts: [
        { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 0 },
        { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 0 },
        { id: 'euro', name: 'Cash EURO', kind: 'cash', currency: 'EUR', start: 0 }
      ]
    },
    tx: list,
    rates: { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: 1 }
  })
const TODAY = '2026-11-18'
const mk = (s: any, name: string, extra: any = {}) => {
  const r = IS.addSource(s, { name, ...extra }, 1000 + s.settings.incomeSources?.length || 0)
  expect(r.ok).toBe(true)
  return r.source
}

describe('the list of sources', () => {
  it('starts empty, adds, renames, recolours, reorders and rejects duplicates', () => {
    const s = money()
    expect(IS.sourcesOf(s)).toEqual([])
    const a = mk(s, 'Job 1')
    const b = mk(s, ' job   2 ')
    expect(b.name).toBe('job 2')
    expect(IS.addSource(s, { name: 'JOB1' }).error).toBe('exists') // "Job 1" without the space is the same name
    expect(IS.addSource(s, { name: '  ' }).error).toBe('name')
    expect(a.color).not.toBe(b.color)
    expect(IS.updateSource(s, a.id, { name: 'Acme', color: 5, emoji: '🏢', payday: 10, expected: 1500000, currency: 'eur' }).ok).toBe(true)
    expect(IS.sourceById(s, a.id)).toMatchObject({ name: 'Acme', color: 5, emoji: '🏢', payday: 10, expected: 1500000, currency: 'EUR' })
    expect(IS.updateSource(s, a.id, { name: 'job2' }).error).toBe('exists')
    expect(IS.updateSource(s, a.id, { payday: '', expected: null, currency: '' }).ok).toBe(true)
    expect(IS.sourceById(s, a.id).payday).toBeUndefined()
    expect(IS.sourceById(s, a.id).expected).toBeUndefined()
    expect(IS.moveSource(s, b.id, -1)).toBe(true)
    expect(IS.sourcesOf(s).map((x: any) => x.name)).toEqual(['job 2', 'Acme'])
    expect(IS.moveSource(s, b.id, -1)).toBe(false)
  })

  it('archiving hides a source from the pickers but keeps it on records and in reports', () => {
    const s = money([tx({ id: 'a' }), tx({ id: 'b', amount: 50000, base: 50000 })])
    const j1 = mk(s, 'Job 1')
    const j2 = mk(s, 'Job 2')
    s.tx[0].incomeSource = j1.id
    s.tx[1].incomeSource = j2.id
    IS.archiveSource(s, j1.id, true)
    expect(IS.activeSources(s).map((x: any) => x.name)).toEqual(['Job 2'])
    expect(IS.sourcesOf(s)).toHaveLength(2)
    expect(s.tx[0].incomeSource).toBe(j1.id)
    expect(IS.txSourceId(s, s.tx[0])).toBe(j1.id)
    const r = IS.sourceTotals(s, '2026-11-01', '2026-11-30')
    expect(r.rows.find((x: any) => x.id === j1.id).amount).toBe(100000)
    expect(IS.sourceReport(s, TODAY).rows.find((x: any) => x.id === j1.id)).toMatchObject({ archived: true, total: 100000 })
    // A name used before cannot be added again, even archived; bringing it back works.
    expect(IS.addSource(s, { name: 'Job 1' }).error).toBe('exists')
    IS.archiveSource(s, j1.id, false)
    expect(IS.activeSources(s)).toHaveLength(2)
  })

  it('only money you earned can carry a source (not loans, refunds, corrections or expenses)', () => {
    const s = money()
    const a = mk(s, 'Job 1')
    for (const t of [tx({ type: 'expense' }), tx({ loan: true }), tx({ refund: true }), tx({ reconcile: true }), tx({ id: 'life-reward-1' })]) {
      expect(IS.setTxSource(t, a.id)).toBe(false)
      expect(t.incomeSource).toBeUndefined()
    }
    const ok = tx()
    expect(IS.setTxSource(ok, a.id, 5)).toBe(true)
    expect(ok.updatedAt).toBe(5)
    expect(IS.setTxSource(ok, a.id)).toBe(false)
    expect(IS.setTxSource(ok, null)).toBe(true)
    expect('incomeSource' in ok).toBe(false)
  })
})

describe('totals per source', () => {
  it('values EUR in MDL, leaves out notIncome, refunds, loans and other months, and shows records with no source', () => {
    const s = money([
      tx({ id: 'j1a', amount: 1000000, base: 1000000, date: '2026-11-03' }),
      tx({ id: 'j2a', amount: 100000, currency: 'EUR', rate: 20, base: 2000000, date: '2026-11-04', account: 'euro' }),
      tx({ id: 'j2b', amount: 500000, base: 500000, date: '2026-10-20' }),
      tx({ id: 'ni', amount: 999900, base: 999900, date: '2026-11-06', notIncome: true }),
      tx({ id: 'rf', amount: 77700, base: 77700, date: '2026-11-06', refund: true, category: 'food' }),
      tx({ id: 'ln', amount: 55500, base: 55500, date: '2026-11-06', loan: true }),
      tx({ id: 'free', amount: 30000, base: 30000, date: '2026-11-07' })
    ])
    const j1 = mk(s, 'Job 1')
    const j2 = mk(s, 'Job 2')
    for (const [id, src] of [['j1a', j1], ['j2a', j2], ['j2b', j2], ['ni', j1]] as const) s.tx.find((t: any) => t.id === id).incomeSource = src.id
    const nov = IS.sourceTotals(s, '2026-11-01', '2026-11-30')
    expect(nov.rows.map((r: any) => [r.id === IS.NONE ? 'none' : IS.sourceName(s, r.id), r.amount])).toEqual([['Job 2', 2000000], ['Job 1', 1000000], ['none', 30000]])
    expect(nov.total).toBe(3030000)
    expect(nov.total).toBe(M.monthSummary(s, '2026-11').income) // the same number everywhere
    expect(nov.rows.reduce((a: number, r: any) => a + Math.round(r.share * 100), 0)).toBeGreaterThanOrEqual(99)
    const rep = IS.sourceReport(s, TODAY)
    expect(rep.keys).toHaveLength(12)
    expect(rep.keys.at(-1)).toBe('2026-11')
    const r2 = rep.rows.find((x: any) => x.id === j2.id)
    expect(r2.total).toBe(2500000)
    expect(r2.byMonth.at(-1)).toBe(2000000)
    expect(r2.byMonth.at(-2)).toBe(500000)
    expect(r2.avg).toBe(1250000) // 2 months since its first record
    expect(rep.thisMonth.total).toBe(3030000)
    expect(rep.lastMonth.total).toBe(500000)
    expect(rep.monthTotals.at(-1)).toBe(3030000)
    // the records behind a source
    expect(IS.sourceRecords(s, j2.id, '2026-10-01', '2026-11-30').map((t: any) => t.id)).toEqual(['j2a', 'j2b'])
    expect(IS.sourceRecords(s, IS.NONE, '2026-11-01', '2026-11-30').map((t: any) => t.id)).toEqual(['free'])
  })

  it('a record pointing at a source this device has not got yet counts as "no source" and is kept', () => {
    const s = money([tx({ id: 'x', incomeSource: 'src-from-another-device' })])
    expect(IS.sourceTotals(s, '2026-11-01', '2026-11-30').rows[0].id).toBe(IS.NONE)
    expect(s.tx[0].incomeSource).toBe('src-from-another-device')
  })
})

describe('quick add understands @source', () => {
  it('"+3000 @job2" and "@Cority" (case and spaces do not matter)', () => {
    const s = money()
    const j2 = mk(s, 'Job 2')
    const c = mk(s, 'Cority')
    const r = parseQuick(s, '+3000 @job2', { today: TODAY })
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('income')
    expect(r.tx.incomeSource).toBe(j2.id)
    expect(r.tx.note).toBe('') // the @word is not left in the note
    expect(r.sourceName).toBe('Job 2')
    expect(parseQuick(s, '3000 salary + @JOB2', { today: TODAY }).tx).toMatchObject({ incomeSource: j2.id, note: 'salary' })
    expect(parseQuick(s, '+3000 @Cority bonus', { today: TODAY }).tx).toMatchObject({ incomeSource: c.id, note: 'bonus' })
    expect(parseQuick(s, '+3000 @cor', { today: TODAY }).tx.incomeSource).toBe(c.id) // a unique start of a name
  })

  it('an unknown @name, two of them, or a source on spending is explained, not guessed', () => {
    const s = money()
    mk(s, 'Job 1')
    mk(s, 'Job 2')
    const unknown = parseQuick(s, '+3000 @job9', { today: TODAY })
    expect(unknown.ok).toBe(false)
    expect(unknown.missing).toMatch(/No income source called/)
    expect(parseQuick(s, '+3000 @job1 @job2', { today: TODAY }).ok).toBe(false)
    expect(parseQuick(s, '+3000 @jo', { today: TODAY }).ok).toBe(false) // "jo" starts two names: not guessed
    const spend = parseQuick(s, '120 lunch @anna', { today: TODAY })
    expect(spend.ok).toBe(true)
    expect(spend.tx.incomeSource).toBeUndefined()
    expect(spend.note).toContain('@anna')
    // an archived source cannot be picked by name
    IS.archiveSource(s, IS.findSourceByName(s, 'job2').id, true)
    expect(parseQuick(s, '+100 @job2', { today: TODAY }).ok).toBe(false)
  })

  it('remembers the last source per note, then per category', () => {
    const s = money([tx({ id: 'o1', note: 'Retainer', date: '2026-10-01' }), tx({ id: 'o2', note: 'Other thing', category: 'work', date: '2026-10-05' })])
    const j1 = mk(s, 'Job 1')
    const j2 = mk(s, 'Job 2')
    s.tx[0].incomeSource = j1.id
    s.tx[1].incomeSource = j2.id
    expect(IS.rememberedSource(s, { category: 'work', note: 'retainer' })).toBe(j1.id) // same note wins
    expect(IS.rememberedSource(s, { category: 'work', note: 'new note' })).toBe(j2.id) // else the newest in the category
    expect(IS.rememberedSource(s, { category: 'other-in', note: '' })).toBeNull()
    const q = parseQuick(s, '+500 retainer', { today: TODAY })
    expect(q.tx.incomeSource).toBe(j1.id)
    IS.archiveSource(s, j1.id, true)
    expect(IS.rememberedSource(s, { category: 'work', note: 'retainer' })).toBe(j2.id) // archived ones are not offered
  })
})

describe('"Create from your records"', () => {
  const records = () => [
    tx({ id: 'w1', category: 'work', note: 'salary', date: '2026-09-05' }),
    tx({ id: 'w2', category: 'work', note: 'Cority', date: '2026-10-05' }),
    tx({ id: 'w3', category: 'work', note: 'cority', date: '2026-11-05' }),
    tx({ id: 'o1', category: 'other-in', note: 'Gift' }),
    tx({ id: 'o2', category: 'other-in', note: '' }),
    tx({ id: 'ni', category: 'work', note: 'Cority', notIncome: true }),
    tx({ id: 'rf', category: 'food', note: 'Refund shop', refund: true }),
    tx({ id: 'ex', type: 'expense', category: 'food', note: 'Cority lunch' })
  ]

  it('suggests categories and repeated notes, changes nothing, skips unusual records', () => {
    const s = money(records())
    const before = JSON.stringify(s)
    const sug = IS.suggestSources(s)
    expect(JSON.stringify(s)).toBe(before) // nothing changes silently
    const names = sug.map((g: any) => g.name)
    expect(names).toContain('Work')
    expect(names).toContain('Cority') // a note that repeats
    expect(names).not.toContain('Gift') // one record in "Other income"
    expect(names).not.toContain('Salary') // one record
    expect(names.some((x: string) => /refund|food|lunch/i.test(x))).toBe(false)
    expect(sug.find((g: any) => g.name === 'Cority').count).toBe(2) // the notIncome record is not counted
  })

  it('creates only the confirmed ones, tags their records once, and one undo step takes it back', () => {
    const s = money(records())
    const h = createHistory()
    h.reset(s)
    const out = IS.applySuggestions(s, [{ key: IS.suggestSources(s).find((g: any) => g.name === 'Work').key, name: 'Work' }, { key: IS.suggestSources(s).find((g: any) => g.name === 'Cority').key, name: 'Cority (client)' }], { tag: true, now: 9 })
    expect(out.created.map((x: any) => x.name).sort()).toEqual(['Cority (client)', 'Work'])
    const cority = IS.findSourceByName(s, 'cority client')
    // Notes first: both Cority records go to Cority, the rest of Work to Work.
    expect(s.tx.find((t: any) => t.id === 'w2').incomeSource).toBe(cority.id)
    expect(s.tx.find((t: any) => t.id === 'w3').incomeSource).toBe(cority.id)
    expect(s.tx.find((t: any) => t.id === 'w1').incomeSource).toBe(IS.findSourceByName(s, 'work').id)
    expect(s.tx.find((t: any) => t.id === 'o1').incomeSource).toBeUndefined()
    expect(s.tx.find((t: any) => t.id === 'ni').incomeSource).toBeUndefined()
    expect(out.tagged).toBe(3)
    h.record(s)
    h.undo(s)
    expect(IS.sourcesOf(s)).toHaveLength(0)
    expect(s.tx.every((t: any) => !t.incomeSource)).toBe(true)
    // Without tagging, only the sources are made.
    const s2 = money(records())
    const o2 = IS.applySuggestions(s2, [{ key: IS.suggestSources(s2)[0].key, name: '' }], { tag: false })
    expect(o2.created).toHaveLength(1)
    expect(s2.tx.every((t: any) => !t.incomeSource)).toBe(true)
  })
})

describe('Log: search, bulk change and history', () => {
  it('source:"Job 2", source:job2 and source:Job 2 find the records; the chip says Source', () => {
    const s = money([tx({ id: 'a', note: 'x' }), tx({ id: 'b', note: 'y' }), tx({ id: 'c', note: 'z' })])
    const j2 = mk(s, 'Job 2')
    mk(s, 'Cority')
    s.tx[1].incomeSource = j2.id
    s.tx[2].incomeSource = IS.findSourceByName(s, 'cority').id
    const ids = (q: string) => searchTx(s, q, TODAY).map((t: any) => t.id)
    expect(ids('source:"Job 2"')).toEqual(['b'])
    expect(ids('source:job2')).toEqual(['b'])
    expect(ids('source:Job 2')).toEqual(['b'])
    expect(ids('SOURCE:cor')).toEqual(['c'])
    expect(ids('source:job2 y')).toEqual(['b'])
    expect(ids('source:job2 z')).toEqual([])
    expect(ids('job 2')).toEqual(['b']) // plain words also see the source name
    expect(queryTerms('source:"Job 2" coffee').map((x: any) => x.label)).toEqual(['Source: Job 2', 'coffee'])
    expect(queryTerms('source:Job 2 >100').map((x: any) => x.label)).toEqual(['Source: Job 2', 'Over 100'])
  })

  it('bulk "Set source" changes Earned records only, in one undo step, and can clear', () => {
    const s = money([tx({ id: 'a' }), tx({ id: 'b' }), tx({ id: 'e', type: 'expense' }), tx({ id: 'l', loan: true })])
    const j1 = mk(s, 'Job 1')
    const h = createHistory()
    h.reset(s)
    expect(Bulk.countApplicable(s, ['a', 'b', 'e', 'l'], 'source', j1.id)).toBe(2)
    const r = Bulk.applyBulk(s, ['a', 'b', 'e', 'l'], 'source', j1.id, { now: 77 })
    expect(r).toEqual({ changed: 2, skipped: 2 })
    expect(s.tx.filter((t: any) => t.incomeSource === j1.id).map((t: any) => t.id)).toEqual(['a', 'b'])
    expect(s.tx[0].updatedAt).toBe(77) // newer, so the sync carries it
    h.record(s)
    expect(Bulk.countApplicable(s, ['a', 'b'], 'source', j1.id)).toBe(0) // already set
    expect(Bulk.applyBulk(s, ['a'], 'source', 'src-nope').changed).toBe(0)
    h.undo(s)
    expect(s.tx.every((t: any) => !t.incomeSource)).toBe(true)
    expect(Bulk.applyBulk(s, ['a'], 'source', j1.id).changed).toBe(1)
    expect(Bulk.applyBulk(s, ['a'], 'source', IS.NONE).changed).toBe(1)
    expect('incomeSource' in s.tx[0]).toBe(false)
  })

  it('source edits are in Change history and undoable: adds, renames and archiving', () => {
    expect(LOGGED).toContain('settings.incomeSources')
    const s = money()
    const a = snapshot(s)
    const j1 = mk(s, 'Job 1')
    const b = snapshot(s)
    expect(diff(a, b).map((c: any) => [c.list, c.kind])).toEqual([['settings.incomeSources', 'added']])
    IS.updateSource(s, j1.id, { name: 'Acme' }, 5)
    IS.archiveSource(s, j1.id, true, 6)
    const c = snapshot(s)
    expect(diff(b, c).map((x: any) => [x.list, x.kind])).toEqual([['settings.incomeSources', 'edited']])
    // The settings key is a list for undo, so a rename is not mixed up with the other settings.
    expect(diff(b, c).some((x: any) => x.list === 'settings')).toBe(false)
    const h = createHistory()
    h.reset(s)
    const j2 = mk(s, 'Job 2')
    h.record(s)
    expect(IS.sourcesOf(s)).toHaveLength(2)
    h.undo(s)
    expect(IS.sourcesOf(s).map((x: any) => x.id)).toEqual([j1.id])
    expect(j2.id).toBeTruthy()
  })
})

describe('Ask and the month review know sources', () => {
  it('"how much from Job 2 this year?" is Earned money on that source', () => {
    const s = money([
      tx({ id: 'a', amount: 300000, base: 300000, date: '2026-03-01' }),
      tx({ id: 'b', amount: 200000, base: 200000, date: '2026-05-01' }),
      tx({ id: 'c', amount: 900000, base: 900000, date: '2026-05-02' }),
      tx({ id: 'd', amount: 400000, base: 400000, date: '2025-12-01' }),
      tx({ id: 'ni', amount: 111100, base: 111100, date: '2026-05-03', notIncome: true })
    ])
    const j2 = mk(s, 'Job 2')
    mk(s, 'Job 1')
    for (const id of ['a', 'b', 'd', 'ni']) s.tx.find((t: any) => t.id === id).incomeSource = j2.id
    const r = askMoney(s, 'How much from Job 2 this year?', TODAY)
    expect(r.ok).toBe(true)
    expect(r.value).toBe(500000)
    expect(r.detail).toMatch(/Earned from Job 2 this year, 2 records/)
    expect(r.search).toContain('source:"Job 2"')
    expect(askMoney(s, 'how much did I earn from job2 in 2025', TODAY).value).toBe(400000)
    expect(askMoney(s, 'how much from Job 1 this year', TODAY).value).toBe(0)
  })

  it('the month review lists the biggest sources of the month, only when you use sources', () => {
    const list = [tx({ id: 'a', amount: 700000, base: 700000, date: '2026-10-05' }), tx({ id: 'b', amount: 100000, base: 100000, date: '2026-10-06' }), tx({ id: 'e', type: 'expense', category: 'food', amount: 50000, base: 50000, date: '2026-10-07' })]
    const s = money(list)
    expect(monthReview(s, '2026-11-03').sources).toEqual([])
    const j1 = mk(s, 'Job 1')
    s.tx[0].incomeSource = j1.id
    const r = monthReview(s, '2026-11-03')
    expect(r.sources.map((x: any) => [x.name, x.amount])).toEqual([['Job 1', 700000], ['No source', 100000]])
  })
})

describe('salary watch per source (clock pinned)', () => {
  const setup = (list: any[], extra: any = {}) => {
    const s = money(list)
    const j = mk(s, 'Job 2', { payday: 10, expected: 1000000, ...extra })
    for (const t of s.tx) if (t.id.startsWith('p')) t.incomeSource = j.id
    return { s, j }
  }
  it('waits until pay day + 2 days, then says late; a matching payment on the source clears it', () => {
    const { s } = setup([])
    expect(sourceWatch(s, '2026-11-12')[0].status).toBe('waiting')
    expect(sourceWatch(s, '2026-11-13')[0].status).toBe('late')
    expect(sourceAlerts(s, '2026-11-13')).toHaveLength(1)
    // money on another source, or with no source, does not count
    s.tx.push(tx({ id: 'q1', amount: 1000000, base: 1000000, date: '2026-11-10' }))
    expect(sourceWatch(s, '2026-11-13')[0].status).toBe('late')
    s.tx.push(tx({ id: 'p1', amount: 1000000, base: 1000000, date: '2026-11-10', incomeSource: s.settings.incomeSources[0].id }))
    expect(sourceWatch(s, '2026-11-13')[0].status).toBe('ok')
    expect(sourceAlerts(s, '2026-11-13')).toHaveLength(0)
  })
  it('says lower than usual when more than 20% under the expected amount, valued in your currency', () => {
    const { s } = setup([tx({ id: 'p1', amount: 700000, base: 700000, date: '2026-11-10' })])
    const w = sourceWatch(s, '2026-11-14')[0]
    expect(w).toMatchObject({ status: 'low', expected: 1000000, received: 700000 })
    expect(sourceWatch(s, '2026-11-11')[0].status).toBe('ok') // too early to judge
    s.tx.push(tx({ id: 'p2', amount: 150000, base: 150000, date: '2026-11-12', incomeSource: s.settings.incomeSources[0].id }))
    expect(sourceWatch(s, '2026-11-14')[0].status).toBe('ok') // two payments add up to 85%
    // expected in EUR (20 MDL here) is compared in MDL
    const e = setup([tx({ id: 'p1', amount: 20000, currency: 'EUR', rate: 20, base: 400000, date: '2026-11-10', account: 'euro' })], { currency: 'EUR', expected: 100000 })
    const we = sourceWatch(e.s, '2026-11-14')[0]
    expect(we.status).toBe('low')
    expect(we.expected).toBe(Math.round(100000 * 17.6 / 0.88)) // 1 000 EUR at the known rate
  })
  it('skips archived sources, sources with no pay day or amount, and notIncome payments', () => {
    const { s, j } = setup([tx({ id: 'p1', amount: 1000000, base: 1000000, date: '2026-11-10', notIncome: true })])
    expect(sourceWatch(s, '2026-11-14')[0].status).toBe('late') // "not income" does not count as pay
    IS.updateSource(s, j.id, { payday: '' })
    expect(sourceWatch(s, '2026-11-14')).toEqual([])
    IS.updateSource(s, j.id, { payday: 31 })
    expect(sourceWatch(s, '2026-11-30')[0].payDate).toBe('2026-11-30') // 31st becomes the month's last day
    IS.archiveSource(s, j.id, true)
    expect(sourceWatch(s, '2026-11-30')).toEqual([])
  })
  // (left out here: needs Life System code)
})

describe('sync keeps the record field and the settings key', () => {
  it('goes to the cloud copy, merges by id (a new source on each device both stay), and an edit on the form keeps or clears the field', () => {
    const a = money([tx({ id: 'a' })])
    const j1 = mk(a, 'Job 1')
    a.tx[0].incomeSource = j1.id
    const cloud = toCloud(a, 'dev-a', 1)
    expect(cloud.data.settings.incomeSources).toHaveLength(1)
    expect(cloud.data.tx[0].incomeSource).toBe(j1.id)
    // Another device made its own source meanwhile.
    const b = money([tx({ id: 'b' })])
    const j2 = mk(b, 'Job 2')
    b.tx[0].incomeSource = j2.id
    const merged = mergeStates(b, cloud).state
    expect(IS.sourcesOf(merged).map((x: any) => x.name).sort()).toEqual(['Job 1', 'Job 2'])
    expect(merged.tx.find((t: any) => t.id === 'a').incomeSource).toBe(j1.id)
    expect(merged.tx.find((t: any) => t.id === 'b').incomeSource).toBe(j2.id)
    // The newer copy of one source wins; archived stays archived.
    IS.archiveSource(a, j1.id, true, 5000)
    const m2 = mergeStates(merged, toCloud(a, 'dev-a', 2)).state
    expect(IS.sourceById(m2, j1.id).archived).toBe(true)
    // A normalise round trip (what loading does) keeps both.
    const back = M.normalizeState(JSON.parse(JSON.stringify(m2)))
    expect(IS.sourcesOf(back)).toHaveLength(2)
    expect(back.tx.find((t: any) => t.id === 'a').incomeSource).toBe(j1.id)
    // The add/edit form owns the field: kept when it sends it, cleared when it does not.
    const existing = back.tx.find((t: any) => t.id === 'a')
    expect(M.keptOnEdit(existing, { ...existing, incomeSource: j2.id }).incomeSource).toBe(j2.id)
    const { incomeSource, ...noSource } = existing
    expect(incomeSource).toBe(j1.id)
    expect(M.keptOnEdit(existing, noSource).incomeSource).toBeUndefined()
  })
})
