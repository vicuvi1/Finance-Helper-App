// Copied from Life System (MEGA origin/main 0d94e87: src/renderer/src/web/financeUsability.test.ts) by scripts/port-mega-tests.mjs.
// Finance Helper usability: undo over the change history (survives a reload, asks
// before another device's change), saved views (relative dates, pinning, sync) and
// the spreadsheet key rules and clipboard parsing. Made-up data; clocks passed in.
import { describe, expect, it } from './_vitest.js'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../js/model.js'
// @ts-ignore
import * as CL from '../../js/changelog.js'
// @ts-ignore
import * as U from '../../js/undolog.js'
// @ts-ignore
import * as SV from '../../js/savedviews.js'
// @ts-ignore
import * as G from '../../js/gridnav.js'
// @ts-ignore
import { createHistory } from '../../js/history.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../js/sync.js'
import { FINANCE } from './_life.js'

let n = 0
const tx = (over: any = {}) => {
  const amount = over.amount ?? 10000
  return { id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: 'Lunch', createdAt: 1000, updatedAt: 1000, ...over }
}
const money = (list: any[]) =>
  M.normalizeState({
    settings: { currency: 'MDL', accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 5000000 }] },
    tx: list,
  })
const T0 = Date.parse('2026-11-17T10:00:00Z')
const fmt = (a: number, c?: string) => `${a / 100} ${c || ''}`.trim()

// A log the way the app writes it: each save observed by a tracker, newest first.
function session(dev: string, steps: Array<(s: any) => void>, s = money([tx({ id: 'a', amount: 12000, base: 12000 }), tx({ id: 'b' })])) {
  let now = T0
  const tr = CL.createTracker({ dev, now: () => now })
  tr.reset(s)
  const log: any[] = []
  for (const step of steps) {
    now += 1000
    step(s)
    log.unshift(...tr.observe(s, 'local'))
  }
  return { s, log, tr }
}

describe('undo from the change history', () => {
  it('the stack is this device\'s actions, newest last; a new action clears redo; it survives a reload (JSON round trip)', () => {
    const { s, log } = session('desktop', [
      (x) => { x.tx.push(tx({ id: 'c', note: 'Coffee', amount: 3000, base: 3000 })) },
      (x) => { x.tx[0] = { ...x.tx[0], amount: 15000, base: 15000, updatedAt: T0 + 5 } },
      (x) => { x.tx = x.tx.filter((t: any) => t.id !== 'b') },
    ])
    const reloaded = JSON.parse(JSON.stringify(log))
    const st = U.stacksOf(reloaded, 'desktop')
    expect(st.undo.map((g: any) => g.entries[0].act)).toEqual(['add', 'edit', 'delete'])
    expect(st.redo).toEqual([])
    // Undo the delete: the record is back; the data matches the step before.
    const top = st.undo.at(-1)
    expect(U.applyGroup(s, top.entries, -1)).toBe(1)
    expect(s.tx.find((t: any) => t.id === 'b')).toBeTruthy()
    expect(s.deleted.b).toBeUndefined()
  })

  it('an undo logged as undo moves the action to redo; redo moves it back; a new action clears redo', () => {
    const { s, log, tr } = session('desktop', [
      (x) => { x.tx[0] = { ...x.tx[0], note: 'Dinner', updatedAt: T0 + 5 } },
      (x) => { x.tx[1] = { ...x.tx[1], note: 'Snack', updatedAt: T0 + 6 } },
    ])
    let st = U.stacksOf(log, 'desktop')
    const second = st.undo.at(-1)
    U.applyGroup(s, second.entries, -1)
    tr.expect({ of: second.entries[0].id })
    log.unshift(...tr.observe(s, 'undo'))
    st = U.stacksOf(log, 'desktop')
    expect(st.undo).toHaveLength(1)
    expect(st.redo.map((g: any) => g.grp)).toEqual([second.grp])
    expect(s.tx[1].note).toBe('Lunch')
    // Redo puts it back.
    U.applyGroup(s, st.redo[0].entries, 1)
    expect(s.tx[1].note).toBe('Snack')
    tr.expect({ of: second.entries[0].id })
    log.unshift(...tr.observe(s, 'redo'))
    st = U.stacksOf(log, 'desktop')
    expect(st.undo).toHaveLength(2)
    expect(st.redo).toEqual([])
    // Undo again, then a brand-new action: redo is gone.
    U.applyGroup(s, st.undo.at(-1).entries, -1)
    tr.expect({ of: st.undo.at(-1).entries[0].id })
    log.unshift(...tr.observe(s, 'undo'))
    s.tx.push(tx({ id: 'z', note: 'New' }))
    log.unshift(...tr.observe(s, 'local'))
    expect(U.stacksOf(log, 'desktop').redo).toEqual([])
  })

  it('other devices\' entries are listed, never on this device\'s stack, and always ask first', () => {
    const mine = session('desktop', [(x) => { x.tx[0] = { ...x.tx[0], note: 'Mine', updatedAt: T0 + 1 } }])
    // The phone changed record b afterwards (it arrives by sync: stamped editedOn).
    const s = mine.s
    const tr = CL.createTracker({ dev: 'desktop', now: () => T0 + 9000 })
    tr.reset(s)
    s.tx[1] = { ...s.tx[1], note: 'From phone', editedOn: 'phone', updatedAt: T0 + 8000 }
    const arrived = tr.observe(s, 'sync')
    expect(arrived[0].dev).toBe('phone')
    const log = [...arrived, ...mine.log]
    const st = U.stacksOf(log, 'desktop')
    expect(st.undo).toHaveLength(1)
    const recent = U.recentActions(log, 'desktop')
    expect(recent.map((g: any) => g.dev)).toEqual(['phone', 'desktop'])
    expect(U.labelOf(recent[0], fmt)).toContain('Edited')
    // Undoing the phone's change needs a question; undoing my own clean change does not.
    expect(U.risks(s, recent[0], -1).foreign).toEqual(['phone'])
    expect(U.risks(s, recent[1], -1)).toEqual({ foreign: [], changed: [] })
  })

  it('asks when the record was changed again since (even by the same device)', () => {
    const { s, log } = session('desktop', [(x) => { x.tx[0] = { ...x.tx[0], note: 'One', updatedAt: T0 + 1 } }])
    s.tx[0] = { ...s.tx[0], note: 'Two (elsewhere)', updatedAt: T0 + 99 }
    const g = U.recentActions(log, 'desktop')[0]
    const r = U.risks(s, g, -1)
    expect(r.foreign).toEqual([])
    expect(r.changed).toHaveLength(1)
  })

  it('recent actions are the last 10, not undo lines or automatic changes; labels read plainly', () => {
    const steps = Array.from({ length: 12 }, (_, i) => (x: any) => { x.tx.push(tx({ id: `n${i}`, note: `Item ${i}`, amount: 100 * (i + 1), base: 100 * (i + 1) })) })
    const { log } = session('web', steps)
    const recent = U.recentActions(log, 'web')
    expect(recent).toHaveLength(10)
    expect(U.labelOf(recent[0], fmt)).toBe('Added Item 11 (12 MDL)')
    const many = session('web', [(x) => { for (const t of x.tx) { t.category = 'transport'; t.updatedAt = T0 + 7 } }])
    expect(U.labelOf(U.recentActions(many.log, 'web')[0], fmt)).toBe('Edited 2 records')
  })

  it('the session undo steps carry their group, so Ctrl+Z can ask about the right change', () => {
    const s = money([tx({ id: 'a' })])
    const h = createHistory()
    h.reset(s)
    s.tx[0] = { ...s.tx[0], note: 'x', updatedAt: 5 }
    h.tag(h.record(s), 'grp-1')
    expect(h.topGrp(-1)).toBe('grp-1')
    h.undo(s)
    expect(h.topGrp(1)).toBe('grp-1')
  })
})

describe('saved views', () => {
  const today = '2026-11-18'
  it('keeps "this month" relative and turns a spelled-out current month into it', () => {
    expect(SV.relativize('food over 200 this month', today)).toBe('food over 200 this month')
    expect(SV.relativize('cat:food from:2026-11-01 to:2026-11-30', today)).toBe('cat:food this month')
    expect(SV.relativize('2026-10-01..2026-10-31 coffee', today)).toBe('last month coffee')
    expect(SV.relativize('from:2026-03-01 to:2026-03-31', today)).toBe('from:2026-03-01 to:2026-03-31')
  })

  it('saves the search, filter, month and view; opening it later resolves the dates again', () => {
    const v = SV.snapshotView('Food over 200 this month', { search: 'cat:food >200 from:2026-11-01 to:2026-11-30', filter: 'expense', month: '2026-11', view: 'table' }, today, 'sv-1')
    expect(v).toMatchObject({ id: 'sv-1', q: 'cat:food >200 this month', filter: 'expense', month: 'now', view: 'table', pinned: true })
    const json = JSON.parse(JSON.stringify(v))
    expect(SV.resolveView(json, '2026-11-18')).toEqual({ search: 'cat:food >200 this month', filter: 'expense', month: '2026-11', view: 'table' })
    expect(SV.resolveView(json, '2027-01-03').month).toBe('2027-01') // "now" follows the calendar
    const old = SV.snapshotView('Last month', { search: '', filter: 'all', month: '2026-10', view: '' }, today)
    expect(old.month).toBe('prev')
    expect(SV.resolveView(old, '2026-12-02').month).toBe('2026-11')
    expect(SV.snapshotView('Spring', { search: '', filter: 'all', month: '2026-03', view: '' }, today).month).toBe('2026-03')
  })

  it('names, renames, reorders, pins at most 8 and deletes', () => {
    const s = money([])
    for (let i = 0; i < 9; i++) SV.addView(s, SV.snapshotView(`View ${i}`, { search: `q${i}`, filter: 'all', month: '2026-11', view: '' }, today, `v${i}`))
    expect(SV.viewsOf(s)).toHaveLength(9)
    expect(SV.pinnedViews(s)).toHaveLength(8) // the ninth is saved but not pinned
    expect(SV.viewsOf(s)[8].pinned).toBe(false)
    expect(SV.setPinned(s, 'v8', true)).toBeNull()
    SV.setPinned(s, 'v0', false)
    expect(SV.setPinned(s, 'v8', true)).not.toBeNull()
    SV.renameView(s, 'v1', '  Coffee runs ')
    expect(SV.viewsOf(s)[1].name).toBe('Coffee runs')
    SV.moveView(s, 'v1', -1)
    expect(SV.viewsOf(s)[0].id).toBe('v1')
    SV.addView(s, SV.snapshotView('coffee runs', { search: 'new', filter: 'all', month: '2026-11', view: '' }, today))
    expect(SV.viewsOf(s)).toHaveLength(9) // same name replaces
    SV.removeView(s, 'v2')
    expect(SV.viewsOf(s).some((v: any) => v.id === 'v2')).toBe(false)
    expect(SV.suggestName('')).toBe('My view')
  })

  it('older saved searches show up as views', () => {
    const s = money([])
    s.settings.savedFilters = [{ q: '>1000', name: 'Big' }]
    expect(SV.viewsOf(s)).toMatchObject([{ name: 'Big', q: '>1000', pinned: true }])
  })

  it('survives a save, the Drive merge and Life\'s sync (a plain settings key)', () => {
    const s = money([])
    s.settings.updatedAt = 1
    SV.addView(s, SV.snapshotView('Big food', { search: 'cat:food >500 this month', filter: 'all', month: '2026-11', view: 'sheet' }, today, 'sv-a'))
    expect(M.normalizeState(JSON.parse(JSON.stringify(s))).settings.savedViews).toHaveLength(1)
    const other = money([])
    other.settings.updatedAt = 0
    const merged = mergeStates(other, { app: 'finance-helper', schema: M.SCHEMA_VERSION, data: toCloud(s, '').data }).state
    expect(merged.settings.savedViews[0]).toMatchObject({ id: 'sv-a', q: 'cat:food >500 this month', view: 'sheet' })
    const shared = FINANCE.share!(s) as any
    expect((FINANCE.fromShared!(shared) as any).settings.savedViews).toHaveLength(1)
  })
})

describe('spreadsheet keys and clipboard', () => {
  const k = (key: string, o: any = {}) => ({ key, ...o })
  it('arrows move and clamp; Ctrl jumps; Tab wraps rows', () => {
    const d = { rows: 4, cols: 3 }
    expect(G.moveCell({ r: 0, c: 0 }, 'ArrowUp', d)).toEqual({ r: 0, c: 0 })
    expect(G.moveCell({ r: 1, c: 1 }, 'ArrowDown', d)).toEqual({ r: 2, c: 1 })
    expect(G.moveCell({ r: 1, c: 1 }, 'ArrowRight', { ...d, jump: true })).toEqual({ r: 1, c: 2 })
    expect(G.tabCell({ r: 0, c: 2 }, false, d)).toEqual({ r: 1, c: 0, edge: false })
    expect(G.tabCell({ r: 1, c: 0 }, true, d)).toEqual({ r: 0, c: 2, edge: false })
    expect(G.tabCell({ r: 3, c: 2 }, false, d).edge).toBe(true)
  })

  it('key meaning: nav mode vs edit mode', () => {
    expect(G.keyIntent(k('Enter'), 'nav')).toEqual({ type: 'edit' })
    expect(G.keyIntent(k('F2'), 'nav')).toEqual({ type: 'edit' })
    expect(G.keyIntent(k('a'), 'nav')).toEqual({ type: 'type', char: 'a' })
    expect(G.keyIntent(k(' '), 'nav')).toBeNull() // Space still shows or hides amounts
    expect(G.keyIntent(k('Delete'), 'nav')).toEqual({ type: 'clear' })
    expect(G.keyIntent(k('Delete', { shift: true }), 'nav')).toEqual({ type: 'delete-record' })
    expect(G.keyIntent(k('ArrowDown', { shift: true }), 'nav')).toMatchObject({ type: 'move', extend: true })
    expect(G.keyIntent(k('d', { ctrl: true }), 'nav')).toEqual({ type: 'fill-down' })
    expect(G.keyIntent(k('z', { ctrl: true }), 'nav')).toBeNull() // record undo stays the page's
    expect(G.keyIntent(k('c', { ctrl: true }), 'nav')).toBeNull() // clipboard events
    expect(G.keyIntent(k('Escape'), 'edit')).toEqual({ type: 'cancel' })
    expect(G.keyIntent(k('Enter'), 'edit')).toEqual({ type: 'commit', dir: 'down' })
    expect(G.keyIntent(k('Tab', { shift: true }), 'edit')).toEqual({ type: 'commit', dir: 'left' })
    expect(G.keyIntent(k('ArrowLeft'), 'edit')).toBeNull() // the caret in the box
    expect(G.keyIntent(k('a', { alt: true }), 'nav')).toBeNull()
  })

  it('parses and writes the clipboard: tabs, lines, quotes, a trailing newline', () => {
    expect(G.parseClipboard('120\n80,50\n')).toEqual([['120'], ['80,50']])
    expect(G.parseClipboard('1\tcoffee\r\n2\ttea')).toEqual([['1', 'coffee'], ['2', 'tea']])
    expect(G.parseClipboard('"a\tb"\t"say ""hi"""')).toEqual([['a\tb', 'say "hi"']])
    expect(G.formatClipboard([['1', 'a\tb'], ['2', '']])).toBe('1\t"a\tb"\n2\t')
    expect(G.parseClipboard(G.formatClipboard([['x', 'y "z"'], ['', '3']]))).toEqual([['x', 'y "z"'], ['', '3']])
  })

  it('a pasted column fills down from the selection, is cut at the edge, and one value fills a range', () => {
    const dims = { rows: 5, cols: 3 }
    const col = G.parseClipboard('10\n20\n30')
    expect(G.pasteTargets({ r1: 1, c1: 2, r2: 1, c2: 2 }, col, dims).cells).toEqual([{ r: 1, c: 2, value: '10' }, { r: 2, c: 2, value: '20' }, { r: 3, c: 2, value: '30' }])
    const cut = G.pasteTargets({ r1: 3, c1: 1, r2: 3, c2: 1 }, G.parseClipboard('1\t2\t3\n4\t5\t6\n7\t8\t9'), dims)
    expect(cut.cells).toHaveLength(4)
    expect(cut.cut).toBe(5)
    const fill = G.pasteTargets({ r1: 0, c1: 0, r2: 1, c2: 1 }, [['x']], dims)
    expect(fill.cells.map((c: any) => `${c.r}${c.c}`)).toEqual(['00', '01', '10', '11'])
  })

  it('fill down copies the top cell (or the cell above for one row)', () => {
    expect(G.fillPlan({ r1: 1, c1: 0, r2: 3, c2: 1 })).toEqual([
      { from: { r: 1, c: 0 }, to: { r: 2, c: 0 } }, { from: { r: 1, c: 0 }, to: { r: 3, c: 0 } },
      { from: { r: 1, c: 1 }, to: { r: 2, c: 1 } }, { from: { r: 1, c: 1 }, to: { r: 3, c: 1 } },
    ])
    expect(G.fillPlan({ r1: 2, c1: 1, r2: 2, c2: 1 })).toEqual([{ from: { r: 1, c: 1 }, to: { r: 2, c: 1 } }])
    expect(G.fillPlan({ r1: 0, c1: 0, r2: 0, c2: 0 })).toEqual([])
  })

  it('cell values: amounts, dates, dropdown matching and type-to-filter', () => {
    expect(G.cleanAmountText('1 200,50 MDL')).toBe('1200,50')
    expect(G.cleanAmountText('12.5')).toBe('12.5')
    expect(G.cleanAmountText('abc')).toBe('')
    expect(G.parseDateCell('2026-11-05')).toBe('2026-11-05')
    expect(G.parseDateCell('5.11.2026')).toBe('2026-11-05')
    expect(G.parseDateCell('31.02.2026')).toBeNull()
    const opts = [{ value: 'food', label: '🍔 Food' }, { value: 'fun', label: '🎮 Fun' }, { value: 'transport', label: '🚌 Transport' }, { value: 'tech', label: 'Tech & food gadgets' }]
    expect(G.matchOption(opts, 'food')?.value).toBe('food')
    expect(G.matchOption(opts, 'TRANS')?.value).toBe('transport')
    expect(G.matchOption(opts, 'nothing')).toBeNull()
    expect(G.filterOptions(opts, 'fo').map((o: any) => o.value)).toEqual(['food', 'tech'])
    expect(G.filterOptions(opts, '')).toHaveLength(4)
  })
})
