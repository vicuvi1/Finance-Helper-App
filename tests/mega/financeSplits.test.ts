// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeSplits.test.ts) by scripts/port-mega-tests.mjs. 3 test(s) that need Life System code (./moneyHub, ./botBrain, @core/funBudget) are left out.
// Split one record (#2): one record, several lines that add up to it. Every
// totals path counts the lines; balances move once. Made-up data only; the day
// is passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as S from '../../js/splits.js'
// @ts-ignore
import { categoryShares } from '../../js/catshare.js'
// @ts-ignore
import { monthRecap } from '../../js/recap.js'
// @ts-ignore
import { everydaySpent } from '../../js/safespend.js'
// @ts-ignore
import { everydayList } from '../../js/everyday.js'
// @ts-ignore
import { monthFlows } from '../../js/longview.js'
// @ts-ignore
import { weeklyReview } from '../../js/review.js'
// @ts-ignore
import { yearReview, taxSummary } from '../../js/yearreview.js'
// @ts-ignore
import { askMoney as ask } from '../../js/ask.js'
// @ts-ignore
import { suggestBudgets } from '../../js/budgetsuggest.js'
// @ts-ignore
import { searchTx } from '../../js/search.js'
// @ts-ignore
import * as Bulk from '../../js/bulk.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'
// @ts-ignore
import { txRows, previewImport } from '../../js/moneyexport.js'
// @ts-ignore
import { sourceTotals } from '../../js/incomesources.js'
// @ts-ignore
import { budgetProgress } from '../../js/budgets.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 100000
  return { id: `s${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: n, updatedAt: n, ...over }
}
const money = (list: any[]) => M.normalizeState({
  settings: {
    currency: 'MDL',
    accounts: [
      { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 0 },
      { id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 5000000 },
      { id: 'euro', name: 'Cash EURO', kind: 'cash', currency: 'EUR', start: 100000 }
    ]
  },
  tx: list,
  rates: { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: 1 }
})
const TODAY = '2026-11-16'
// The acceptance case: a 600 MDL shop split 400 Food / 200 Home.
const shop = (over: any = {}) => tx({ id: 'shop', amount: 60000, note: 'Supermarket', category: 'food', splits: [{ category: 'food', amount: 40000 }, { category: 'home', amount: 20000, note: '#house' }], ...over })
const cat = (rows: any[], id: string) => rows.find((r: any) => r.id === id)?.amount ?? 0

describe('lines', () => {
  it('validLines: two or more, each above 0 with a category, adding up', () => {
    expect(S.isSplit(shop())).toBe(true)
    expect(S.isSplit(shop({ amount: 60001 }))).toBe(false)
    expect(S.isSplit(shop({ splits: [{ category: 'food', amount: 60000 }] }))).toBe(false)
    expect(S.isSplit(shop({ splits: [{ category: 'food', amount: 60000 }, { category: 'home', amount: 0 }] }))).toBe(false)
    expect(S.isSplit(shop({ splits: [{ category: '', amount: 30000 }, { category: 'home', amount: 30000 }] }))).toBe(false)
    expect(S.isSplit(shop({ type: 'transfer' }))).toBe(false)
    expect(S.isSplit(shop({ loan: true }))).toBe(false)
    expect(S.brokenSplit(shop({ amount: 50000 }))).toBe(true)
  })

  it('splitLines shares the base (EUR valued in MDL), the last line takes the rounding', () => {
    const t = tx({ id: 'e', amount: 1000, currency: 'EUR', rate: 19.87, base: 19870, account: 'euro', splits: [{ category: 'food', amount: 333 }, { category: 'home', amount: 333 }, { category: 'fun', amount: 334 }] })
    const lines = S.splitLines(t)
    expect(lines.map((l: any) => l.amount)).toEqual([333, 333, 334])
    expect(lines.reduce((a: number, l: any) => a + l.base, 0)).toBe(19870)
    expect(lines.every((l: any) => l.id === 'e' && l.lineOf === 'e' && !l.splits)).toBe(true)
    expect(lines[1].note).toBeUndefined()
  })

  it('a line note joins the record note (tags in either count for that line)', () => {
    const [a, b] = S.splitLines(shop())
    expect(a.note).toBe('Supermarket')
    expect(b.note).toBe('Supermarket · #house')
  })

  it('expandSplits gives back the same array when nothing is split', () => {
    const list = [tx(), tx()]
    expect(S.expandSplits(list)).toBe(list)
    expect(S.expandSplits([shop(), tx()])).toHaveLength(3)
  })

  it('checkSplit: live counter and errors', () => {
    expect(S.checkSplit(60000, [{ amount: 40000, category: 'food' }, { amount: 20000, category: 'home' }])).toMatchObject({ ok: true, left: 0 })
    expect(S.checkSplit(60000, [{ amount: 40000, category: 'food' }, { amount: 0, category: 'home' }])).toMatchObject({ ok: false, error: 'Each line needs an amount above 0' })
    expect(S.checkSplit(60000, [{ amount: 40000, category: 'food' }, { amount: 10000, category: 'home' }])).toMatchObject({ ok: false, left: 10000, error: 'left' })
    expect(S.checkSplit(60000, [{ amount: 40000, category: 'food' }, { amount: 30000, category: 'home' }])).toMatchObject({ ok: false, left: -10000, error: 'over' })
    expect(S.checkSplit(60000, [{ amount: 60000, category: 'food' }]).error).toBe('Add at least two lines')
    expect(S.checkSplit(60000, [{ amount: 30000, category: 'food' }, { amount: 30000, category: '' }]).error).toBe('Pick a category for each line')
  })

  it('withSplits and unsplit', () => {
    const t = tx({ id: 'w', amount: 60000, category: 'other', sub: 'x' })
    const s = S.withSplits(t, [{ category: 'food', amount: 40000, note: ' ' }, { category: 'home', amount: 20000 }])
    expect(s.splits).toEqual([{ category: 'food', amount: 40000 }, { category: 'home', amount: 20000 }])
    expect(s.category).toBe('food')
    expect(s.sub).toBeUndefined()
    expect(S.withSplits(t, [{ category: 'food', amount: 40000 }, { category: 'home', amount: 10000 }])).toBeNull()
    const u = S.unsplit(s)
    expect(u.splits).toBeUndefined()
    expect(u.category).toBe('food')
    expect(u.amount).toBe(60000)
  })
})

describe('every totals path counts the lines, balances move once', () => {
  const st = () => money([shop(), tx({ id: 'f2', amount: 10000, category: 'food' }), tx({ id: 'pay', type: 'income', category: 'work', amount: 500000, date: '2026-11-02' })])

  it('model: month summary, categories, budgets, report', () => {
    const s = st()
    const m = M.monthSummary(s, '2026-11')
    expect(m.expense).toBe(70000)
    expect(cat(m.byCategory, 'food')).toBe(50000)
    expect(cat(m.byCategory, 'home')).toBe(20000)
    expect(m.count).toBe(3)
    s.settings.categories.find((c: any) => c.id === 'food').budget = 100000
    s.settings.categories.find((c: any) => c.id === 'home').budget = 100000
    const b = M.budgetStatus(s, '2026-11', TODAY)
    expect(b.rows.find((r: any) => r.category.id === 'food').spent).toBe(50000)
    expect(b.rows.find((r: any) => r.category.id === 'home').spent).toBe(20000)
    const r = M.report(s, '2026-11-01', '2026-11-30')
    expect(r.expense).toBe(70000)
    expect(cat(r.spending.rows, 'home')).toBe(20000)
    expect(r.count).toBe(3)
    expect(cat(M.totalsByCategory(s, '2026-11-01', '2026-11-30').rows, 'food')).toBe(50000)
  })

  it('one balance change', () => {
    const s = st()
    expect(M.accountBalances(s).card).toBe(5000000 + 500000 - 60000 - 10000)
    const plain = money([tx({ id: 'shop', amount: 60000, note: 'Supermarket' }), tx({ id: 'f2', amount: 10000 }), tx({ id: 'pay', type: 'income', category: 'work', amount: 500000, date: '2026-11-02' })])
    expect(M.accountBalances(s)).toEqual(M.accountBalances(plain))
    expect(s.tx).toHaveLength(3)
  })

  it('category shares, recap, safe to spend, long view, weekly review', () => {
    const s = st()
    const sh = categoryShares(s.tx, { from: '2026-11-01', to: '2026-11-30' }, M.B)
    expect(sh.total).toBe(70000)
    expect(cat(sh.rows, 'home')).toBe(20000)
    const rc = monthRecap(s, '2026-11')
    expect(rc.spent).toBe(70000)
    expect(rc.top.find((c: any) => c.id === 'home').amount).toBe(20000)
    s.settings.categories.find((c: any) => c.id === 'home').bill = true
    expect(everydaySpent(s, '2026-11-01', '2026-11-30')).toBe(50000) // the Home line is a bill
    expect(monthFlows(s, { from: '2026-11-01', to: '2026-11-30' }).get('2026-11').spending).toBe(70000)
    const wr = weeklyReview(s, '2026-11-08')
    expect(wr.expense).toBe(70000)
    expect(wr.records).toBe(3) // records, not lines
  })

  it('Everyday only: one-off is the whole buy, work costs per line', () => {
    const s = money([tx({ id: 'big', amount: 120000, splits: [{ category: 'food', amount: 60000 }, { category: 'home', amount: 60000 }] })])
    const r = everydayList(s.tx, { settings: s.settings, rates: s.rates, base: M.B, from: '2026-11-01', to: '2026-11-30' })
    expect(r.leftOut).toBe(120000) // 1 200 MDL is a one-off, even split in two
  })

  it('year summary, Ask and budget suggestions', () => {
    const s = st()
    const y = yearReview(s, 2026, TODAY)
    expect(y.records).toBe(3)
    const a = ask(s, 'how much on home this month', TODAY)
    expect(a.value).toBe(20000)
    const s2 = money([shop({ date: '2026-10-05' })])
    const sug = suggestBudgets(s2, TODAY, 1)
    expect(sug.find((x: any) => x.id === 'home')?.average).toBe(20000)
  })

  it('week / tag budgets (js/budgets.js) count only the matching line', () => {
    const s = st()
    const p = budgetProgress(s, { id: 'b1', name: 'Home', period: 'month', limit: 100000, cats: ['home'] }, TODAY)
    expect(p.spent).toBe(20000)
    const t = budgetProgress(s, { id: 'b2', name: 'House', period: 'month', limit: 100000, tags: ['house'] }, TODAY)
    expect(t.spent).toBe(20000)
  })

  it('an income split across two sources', () => {
    const s = money([tx({ id: 'inc', type: 'income', amount: 300000, category: 'work', incomeSource: 'job1', splits: [{ category: 'work', amount: 200000 }, { category: 'side', amount: 100000, incomeSource: 'job2' }] })])
    s.settings.incomeSources = [{ id: 'job1', name: 'Job 1', color: 1 }, { id: 'job2', name: 'Job 2', color: 2 }]
    const m = M.monthSummary(s, '2026-11')
    expect(m.income).toBe(300000)
    expect(cat(m.bySource, 'side')).toBe(100000)
    const rows = taxSummary(s, 2026).rows
    expect(rows.map((r: any) => r.base)).toEqual([200000, 100000])
    // Income sources (js/incomesources.js): the first line keeps the record's source, the second has its own.
    const st = sourceTotals(s, '2026-11-01', '2026-11-30')
    expect(cat(st.rows, 'job1')).toBe(200000)
    expect(cat(st.rows, 'job2')).toBe(100000)
    expect(st.total).toBe(300000)
  })

  it('notIncome / notSpending: the lines are left out too', () => {
    const s = money([shop({ notSpending: true })])
    expect(M.monthSummary(s, '2026-11').expense).toBe(0)
    expect(M.monthSummary(s, '2026-11').byCategory).toEqual([])
    expect(categoryShares(s.tx, { from: '2026-11-01', to: '2026-11-30' }, M.B).total).toBe(0)
    const s2 = money([tx({ id: 'ni', type: 'income', category: 'work', amount: 100000, notIncome: true, splits: [{ category: 'work', amount: 50000 }, { category: 'side', amount: 50000 }] })])
    expect(M.monthSummary(s2, '2026-11').income).toBe(0)
  })

  it('a split refund lowers each line\'s category', () => {
    const s = money([shop(), tx({ id: 'ref', type: 'income', refund: true, amount: 15000, category: 'food', splits: [{ category: 'food', amount: 10000 }, { category: 'home', amount: 5000 }] })])
    const m = M.monthSummary(s, '2026-11')
    expect(m.income).toBe(0)
    expect(m.expense).toBe(45000)
    expect(cat(m.byCategory, 'food')).toBe(30000)
    expect(cat(m.byCategory, 'home')).toBe(15000)
  })

  it('EUR record valued in MDL: lines in MDL add up to the record', () => {
    const s = money([tx({ id: 'eu', amount: 5000, currency: 'EUR', rate: 20, base: 100000, account: 'euro', splits: [{ category: 'food', amount: 3000 }, { category: 'fun', amount: 2000 }] })])
    const m = M.monthSummary(s, '2026-11')
    expect(m.expense).toBe(100000)
    expect(cat(m.byCategory, 'food')).toBe(60000)
    expect(cat(m.byCategory, 'fun')).toBe(40000)
    expect(M.accountBalances(s).euro).toBe(100000 - 5000)
  })

  it('lines that do not add up count as one plain record (totals never drift)', () => {
    const s = money([shop({ amount: 70000 })])
    const m = M.monthSummary(s, '2026-11')
    expect(m.expense).toBe(70000)
    expect(cat(m.byCategory, 'food')).toBe(70000)
  })

  it('old records without lines behave exactly as before', () => {
    const list = [tx({ id: 'a' }), tx({ id: 'b', category: 'home' })]
    const s = money(list)
    expect(M.monthSummary(s, '2026-11').byCategory).toEqual([{ id: 'food', amount: 100000 }, { id: 'home', amount: 100000 }])
    expect(S.linesOf(s)).toBe(s.tx)
  })
})

describe('Life side and bot readers', () => {
  // (left out here: needs Life System code)

  // (left out here: needs Life System code)

  // (left out here: needs Life System code)
})

describe('search, bulk, sync, export', () => {
  it('search finds the record by a line, totals come from the matching line', () => {
    const s = money([shop(), tx({ id: 'x', category: 'fun' })])
    expect(searchTx(s, 'cat:home', TODAY).map((t: any) => t.id)).toEqual(['shop'])
    expect(searchTx(s, '#house', TODAY).map((t: any) => t.id)).toEqual(['shop'])
    const lines = searchTx(s, 'cat:home', TODAY, { lines: true })
    expect(lines.map((t: any) => t.amount)).toEqual([20000])
    expect(searchTx(s, '>500', TODAY).map((t: any) => t.id)).toEqual(['shop', 'x'])
  })

  it('bulk "Set category" leaves a split record alone', () => {
    const s = money([shop(), tx({ id: 'x' })])
    const r = Bulk.applyBulk(s, ['shop', 'x'], 'category', 'fun')
    expect(r).toEqual({ changed: 1, skipped: 1 })
    expect(s.tx.find((t: any) => t.id === 'shop').splits).toHaveLength(2)
  })

  it('the lines travel with the sync (newest record wins) and survive normalizeState', () => {
    const local = money([tx({ id: 'shop', amount: 60000, updatedAt: 1 })])
    const remote = money([shop({ updatedAt: 5 })])
    const merged = mergeStates(local, toCloud(remote, 'dev2')).state
    expect(merged.tx.find((t: any) => t.id === 'shop').splits).toHaveLength(2)
    expect(M.monthSummary(merged, '2026-11').byCategory.find((r: any) => r.id === 'home').amount).toBe(20000)
  })

  it('the export keeps the lines and the import brings them back', () => {
    const s = money([shop()])
    const rows = txRows(s)
    const empty = money([])
    const p = previewImport(rows, empty)
    expect(p.add).toHaveLength(1)
    expect(p.add[0].splits).toEqual(shop().splits)
  })
})
