// Just enough of vitest's API on top of node:test, so Money's unit tests from
// Life System (MEGA) run here as they are (tests/mega/*.test.ts, copied by
// scripts/port-mega-tests.mjs). Matchers keep vitest's meaning: toEqual is a
// deep equality that ignores undefined properties, toMatchObject is a subset.
import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual, inspect } from 'node:util';

export { describe, it, test, beforeEach, afterEach };
export const beforeAll = before;
export const afterAll = after;

const show = (v) => inspect(v, { depth: 6, breakLength: 120 });
const clean = (v) => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype || (v && typeof v === 'object' && Object.getPrototypeOf(v) === null)) {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = clean(v[k]);
    return o;
  }
  return v;
};
const deepEq = (a, b) => isDeepStrictEqual(clean(a), clean(b));

function subset(actual, expected) {
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  if (expected && typeof expected === 'object' && expected.__asymmetric) return expected.match(actual);
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => subset(actual[i], e));
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.keys(expected).every((k) => subset(actual[k], expected[k]));
  }
  return Object.is(actual, expected) || deepEq(actual, expected);
}

function matchers(actual, negate) {
  const check = (pass, msg) => {
    if (negate ? pass : !pass) throw new assert.AssertionError({ message: `${negate ? 'not ' : ''}${msg}`, actual, operator: 'expect' });
  };
  const m = {
    toBe: (e) => check(Object.is(actual, e), `expected ${show(actual)} to be ${show(e)}`),
    toEqual: (e) => check(deepEq(actual, e) || subsetAsym(actual, e), `expected ${show(actual)} to equal ${show(e)}`),
    toStrictEqual: (e) => check(isDeepStrictEqual(actual, e), `expected ${show(actual)} to strictly equal ${show(e)}`),
    toMatchObject: (e) => check(subset(actual, e), `expected ${show(actual)} to match ${show(e)}`),
    toHaveLength: (n) => check(actual?.length === n, `expected length ${n}, got ${actual?.length}`),
    toBeNull: () => check(actual === null, `expected ${show(actual)} to be null`),
    toBeUndefined: () => check(actual === undefined, `expected ${show(actual)} to be undefined`),
    toBeDefined: () => check(actual !== undefined, 'expected a value'),
    toBeTruthy: () => check(!!actual, `expected ${show(actual)} to be truthy`),
    toBeFalsy: () => check(!actual, `expected ${show(actual)} to be falsy`),
    toBeNaN: () => check(Number.isNaN(actual), `expected ${show(actual)} to be NaN`),
    toMatch: (re) => check(typeof actual === 'string' && (re instanceof RegExp ? re.test(actual) : actual.includes(re)), `expected ${show(actual)} to match ${re}`),
    toContain: (x) => check(typeof actual === 'string' ? actual.includes(x) : Array.from(actual ?? []).some((y) => Object.is(y, x)), `expected ${show(actual)} to contain ${show(x)}`),
    toContainEqual: (x) => check(Array.from(actual ?? []).some((y) => deepEq(y, x)), `expected ${show(actual)} to contain ${show(x)}`),
    toBeCloseTo: (e, digits = 2) => check(Math.abs(actual - e) < 10 ** -digits / 2, `expected ${actual} to be close to ${e}`),
    toBeGreaterThan: (e) => check(actual > e, `expected ${actual} > ${e}`),
    toBeGreaterThanOrEqual: (e) => check(actual >= e, `expected ${actual} >= ${e}`),
    toBeLessThan: (e) => check(actual < e, `expected ${actual} < ${e}`),
    toBeLessThanOrEqual: (e) => check(actual <= e, `expected ${actual} <= ${e}`),
    toBeInstanceOf: (C) => check(actual instanceof C, `expected an instance of ${C?.name}`),
    toHaveProperty: (k, v) => check(actual != null && k in Object(actual) && (v === undefined || deepEq(actual[k], v)), `expected property ${k}`),
    toThrow: (want) => {
      let threw = false;
      let err;
      try { actual(); } catch (e) { threw = true; err = e; }
      const ok = threw && (want == null || (want instanceof RegExp ? want.test(String(err?.message ?? err)) : typeof want === 'string' ? String(err?.message ?? err).includes(want) : typeof want === 'function' ? err instanceof want : true));
      check(ok, `expected a throw${want ? ` matching ${want}` : ''}${threw ? `, got ${err?.message}` : ''}`);
    },
    toHaveBeenCalled: () => check((actual?.mock?.calls?.length ?? 0) > 0, 'expected a call'),
    toHaveBeenCalledTimes: (n) => check((actual?.mock?.calls?.length ?? 0) === n, `expected ${n} calls, got ${actual?.mock?.calls?.length}`),
    toHaveBeenCalledWith: (...args) => check((actual?.mock?.calls ?? []).some((c) => deepEq(c, args)), `expected a call with ${show(args)}`),
  };
  return m;
}
function subsetAsym(actual, e) {
  return e && typeof e === 'object' && JSON.stringify(e, (_k, v) => (v && v.__asymmetric ? '__A__' : v)).includes('__A__') && subset(actual, e);
}

export function expect(actual) {
  const out = matchers(actual, false);
  out.not = matchers(actual, true);
  const asyncSide = (kind) => new Proxy({}, {
    get: (_t, name) => async (...args) => {
      let value;
      let error;
      let threw = false;
      try { value = await actual; } catch (e) { threw = true; error = e; }
      if (kind === 'resolves') {
        if (threw) throw new assert.AssertionError({ message: `expected to resolve, rejected with ${error?.message}` });
        return matchers(value, false)[name](...args);
      }
      if (!threw) throw new assert.AssertionError({ message: 'expected to reject' });
      if (name === 'toThrow') return matchers(() => { throw error; }, false).toThrow(...args);
      return matchers(error, false)[name](...args);
    },
  });
  out.resolves = asyncSide('resolves');
  out.rejects = asyncSide('rejects');
  return out;
}
const asym = (match) => ({ __asymmetric: true, match });
expect.any = (C) => asym((v) => (C === Number ? typeof v === 'number' : C === String ? typeof v === 'string' : C === Boolean ? typeof v === 'boolean' : C === Function ? typeof v === 'function' : C === Object ? v !== null && typeof v === 'object' : v instanceof C));
expect.anything = () => asym((v) => v != null);
expect.stringContaining = (s) => asym((v) => typeof v === 'string' && v.includes(s));
expect.stringMatching = (re) => asym((v) => typeof v === 'string' && re.test(v));
expect.objectContaining = (o) => asym((v) => subset(v, o));
expect.arrayContaining = (arr) => asym((v) => Array.isArray(v) && arr.every((e) => v.some((x) => subset(x, e))));

// ---- fake clock (ids never repeat, unlike node:test's mock timers after a reset) ----
const RealDate = Date;
const real = { setTimeout, clearTimeout, setInterval, clearInterval };
let nextId = 1e6;
const clock = {
  on: false,
  now: 0,
  timers: new Map(),
  install(now) {
    this.on = true;
    this.now = now;
    this.timers.clear();
    const c = this;
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(c.now); }
      static now() { return c.now; }
    }
    globalThis.Date = FakeDate;
    const add = (fn, ms, every, args) => { const id = ++nextId; c.timers.set(id, { at: c.now + Math.max(0, Number(ms) || 0), fn, every: every ? Math.max(1, Number(ms) || 0) : 0, args }); return id; };
    globalThis.setTimeout = (fn, ms, ...args) => add(fn, ms, false, args);
    globalThis.setInterval = (fn, ms, ...args) => add(fn, ms, true, args);
    globalThis.clearTimeout = globalThis.clearInterval = (id) => { c.timers.delete(id); };
  },
  uninstall() {
    if (!this.on) return;
    this.on = false;
    this.timers.clear();
    globalThis.Date = RealDate;
    Object.assign(globalThis, real);
  },
  tick(ms) {
    const end = ms === Infinity ? Infinity : this.now + ms;
    for (let guard = 0; guard < 100000; guard++) {
      let next = null;
      for (const [id, t] of this.timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      this.now = Math.max(this.now, t.at);
      if (t.every) t.at += t.every; else this.timers.delete(id);
      t.fn(...(t.args || []));
    }
    if (end !== Infinity) this.now = end;
  },
};

// ---- vi ----
const stubs = new Map();
const spies = [];
export const vi = {
  fn(impl = () => undefined) {
    const f = (...args) => { f.mock.calls.push(args); return f._impl(...args); };
    f._impl = impl;
    f.mock = { calls: [] };
    f.mockImplementation = (g) => { f._impl = g; return f; };
    f.mockReturnValue = (v) => { f._impl = () => v; return f; };
    f.mockResolvedValue = (v) => { f._impl = () => Promise.resolve(v); return f; };
    f.mockRejectedValue = (v) => { f._impl = () => Promise.reject(v); return f; };
    f.mockClear = () => { f.mock.calls = []; return f; };
    return f;
  },
  spyOn(obj, name) {
    const orig = obj[name];
    const f = vi.fn((...a) => orig.apply(obj, a));
    obj[name] = f;
    f.mockRestore = () => { obj[name] = orig; };
    spies.push(f);
    return f;
  },
  restoreAllMocks() { while (spies.length) spies.pop().mockRestore(); },
  stubGlobal(name, value) {
    if (!stubs.has(name)) stubs.set(name, Object.getOwnPropertyDescriptor(globalThis, name) ?? null);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true });
  },
  unstubAllGlobals() {
    for (const [name, d] of stubs) { if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name]; }
    stubs.clear();
  },
  useFakeTimers(opts = {}) { clock.install(opts.now != null ? Number(new Date(opts.now)) : RealDate.now()); return vi; },
  useRealTimers() { clock.uninstall(); return vi; },
  setSystemTime(t) { if (!clock.on) clock.install(RealDate.now()); clock.now = Number(new Date(t)); return vi; },
  advanceTimersByTime(ms) { clock.tick(ms); return vi; },
  async advanceTimersByTimeAsync(ms) { clock.tick(ms); await Promise.resolve(); return vi; },
  runAllTimers() { clock.tick(Infinity); return vi; },
};
