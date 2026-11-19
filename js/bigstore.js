// The big things this device keeps, out of localStorage and in IndexedDB.
//
// localStorage gives one site about 5 million characters. That was the limit
// for Money: about 20,000 records. IndexedDB has no such limit (it is bounded
// by the disk), so these keys live there, behind the same getItem / setItem /
// removeItem as before:
//   finance-helper.state / .enc      Money's own data (plain, or sealed with its PIN)
//   life_sync_app_sync_<app>         the copy the sync last agreed on
//   …_before_restore                 the copy from before a restore
//   life_sync_app_sync_finance_sealed_seen / _mine / _plain   the locked sync's copies
//   life_offline_writes              the website's changes waiting for a connection
//
// One store per window. Life System and the Money frame inside it share one
// (Money takes its parent's), so both see a write at once. Money opened on its
// own, and other windows and tabs, each have their own store over the same
// IndexedDB and tell each other over a BroadcastChannel.
//
// How it stays safe:
// - Reads and writes are answered from memory at once; the write to IndexedDB
//   follows. `flush()` waits for it and throws if it failed. Whoever says
//   "saved" awaits it first.
// - Moving an old copy over: written to IndexedDB, read back in a NEW
//   transaction, compared letter for letter, and only then removed from
//   localStorage. If anything differs, the old copy stays where it is and is
//   used from there.
// - Money's own data moves only after the new Money has started once on this
//   device (`moveIn()`, which leaves the mark `finance-helper.store`). Until
//   then it stays in localStorage exactly as before, so an older Money still
//   in a cache never finds its data gone.
// - Money's data is never replaced by a copy the window did not know: a copy
//   that shows up in localStorage later (an older tab, a write that could not
//   go to IndexedDB), and a write from a window that had not yet seen another
//   window's write, are MERGED with Money's own merge (newest copy of each
//   record wins, deletions stick). Sealed data cannot be merged: the later
//   one is used and the other is kept under "<key>.kept".
// - A page of an older version may still be open in another tab and keep
//   writing Money to localStorage. Its copy is merged in every time and left
//   where that page expects it; the next start of a new page removes it.
// - No IndexedDB (a private window, a blocked store, no answer in 4 seconds):
//   the keys stay in localStorage exactly as before, and status() says why.
// - A write still on its way when the page closes is also put in localStorage
//   (if it fits) and picked up on the next start.
// - Every window that uses the store gets a `storage` event for a change to
//   Money's data it did not make itself, as localStorage gave.

export const MONEY_KEY = 'finance-helper.state';
export const MONEY_ENC = 'finance-helper.enc';
/** In localStorage: 'idb' once the new Money has started on this device. */
export const MONEY_MARK = 'finance-helper.store';
export const OUTBOX_KEY = 'life_offline_writes';
export const CHANNEL = 'life-big-store';

/** Money's own data: moves only after the new Money has started once, and is merged, never replaced. */
export const isAppKey = (key) => key === MONEY_KEY || key === MONEY_ENC;
/** The keys that live here. */
export const isBigKey = (key) =>
  isAppKey(key) || key === OUTBOX_KEY || /^life_sync_app_sync_[a-z]+(_before_restore)?$/.test(key) || /^life_sync_app_sync_finance_sealed_(seen|mine|plain)$/.test(key);

const PENDING = 'life_big_pending:';
/** With a waiting copy of Money's data: the marks of what IndexedDB held when it was written. */
const PENDING_BASE = 'life_big_pending_base:';
const KEPT = '.kept';
const DB_NAME = 'life-big-store';
const STORE = 'kv';
const OPEN_WAIT = 4000;

/** A short mark of a text, to tell whether two long texts are the same without keeping both. */
export const textMark = (text) => {
  let a = 0x811c9dc5;
  let b = 0x1b873593;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13);
  }
  return `${text.length}.${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
};

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

/**
 * opts: { local, idb?, isBig?, isGated?, mark?, merge?(key, mine, theirs) -> text | null,
 *         name?, channel?, onError?(message), win?, openWait? }
 */
export function createBigStore(opts) {
  const { local } = opts;
  const big = opts.isBig ?? isBigKey;
  const gated = opts.isGated ?? isAppKey;
  const mark = opts.mark ?? MONEY_MARK;
  const ownWin = opts.win === undefined ? (typeof window !== 'undefined' ? window : null) : opts.win;
  const idb = opts.idb === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : opts.idb;
  const cache = new Map();
  /** Money's data as this window last knew it to be in IndexedDB (a write that finds something else there merges). */
  const base = new Map();
  /** The last text read from localStorage, for the moment another window has just moved it away. */
  const last = new Map();
  /** Keys written or removed here since the start: the load from disk must not undo them. */
  const touched = new Set();
  /** Keys whose move failed its check: they stay in localStorage and are used from there. */
  const stay = new Set();
  let mode = 'localStorage';
  let db = null;
  let error = null;
  let marked = false;
  /** Keys whose last write is stored nowhere on this device. */
  const failed = new Map();
  let tail = Promise.resolve();
  const waiting = new Map();
  /** Copies in localStorage already taken in while running, and left there for the page that wrote them. */
  const taken = new Map();
  /** The write of Money's data on its way to IndexedDB right now (key -> text). */
  const flying = new Map();
  /** The windows that hear about a change to Money's data (Life's page and the Money frame in it). */
  const windows = new Set();
  const facades = new WeakMap();
  /** The page each of those windows showed when it last asked for the store. */
  const pages = new WeakMap();

  const fail = (what, e) => {
    error = `${what}: ${String(e?.message ?? e?.name ?? e)}`.slice(0, 240);
    try {
      opts.onError?.(error);
    } catch {
      /* the listener's problem */
    }
  };
  const safeGet = (k) => {
    try {
      return local.getItem(k);
    } catch {
      return null;
    }
  };
  const safeDel = (k) => {
    try {
      local.removeItem(k);
    } catch {
      /* private window */
    }
  };
  const gateOpen = () => marked || (marked = safeGet(mark) === 'idb');
  /** May this key live in IndexedDB now? */
  const may = (key) => big(key) && (!gated(key) || gateOpen());
  const inIdb = (key) => mode === 'indexeddb' && db != null && may(key) && !stay.has(key);
  const mergeText = (key, mine, theirs) => {
    if (!opts.merge) return null;
    try {
      const out = opts.merge(key, mine, theirs);
      return typeof out === 'string' && out ? out : null;
    } catch {
      return null;
    }
  };

  /** A `storage` event for every window that uses this store, but not the one that made the change. */
  const announce = (key, from = null) => {
    if (!gated(key) || !windows.size) return;
    void Promise.resolve().then(() => {
      for (const w of [...windows]) {
        if (w === from) continue;
        try {
          if (w.closed) {
            windows.delete(w);
            continue;
          }
          const E = w.StorageEvent ?? w.Event;
          const ev = new E('storage', { key, newValue: cache.has(key) ? cache.get(key) : null, url: String(w.location?.href ?? '') });
          if (!('key' in ev) || ev.key !== key) Object.defineProperty(ev, 'key', { value: key });
          w.dispatchEvent(ev);
        } catch {
          windows.delete(w);
        }
      }
    });
  };

  const openDb = () => {
    const r = idb.open(opts.name ?? DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    // A browser that never answers must not keep Money from starting.
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no answer from IndexedDB')), opts.openWait ?? OPEN_WAIT);
      req(r).then(
        (d) => {
          clearTimeout(t);
          resolve(d);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  };
  const read = async (key) => {
    const v = await req(db.transaction(STORE).objectStore(STORE).get(key));
    return typeof v === 'string' ? v : null;
  };
  /** One write, as given. */
  const put = async (key, value) => {
    const tx = db.transaction(STORE, 'readwrite');
    const finish = done(tx);
    if (value == null) tx.objectStore(STORE).delete(key);
    else tx.objectStore(STORE).put(value, key);
    await finish;
    return value;
  };
  /** Reads what IndexedDB holds and writes what `decide` makes of it, in one transaction. Returns what was stored. */
  const swap = async (key, decide) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const finish = done(tx);
    let out = null;
    let thrown = null;
    const r = os.get(key);
    r.onsuccess = () => {
      try {
        out = decide(typeof r.result === 'string' ? r.result : null, os);
        os.put(out, key);
      } catch (e) {
        thrown = e;
      }
    };
    await finish;
    if (thrown) throw thrown;
    return out;
  };
  /**
   * A write from this window. Money's data: if IndexedDB holds something this window did not
   * know (another window wrote first), the two are merged instead of one replacing the other.
   */
  const store1 = (key, value) =>
    value == null || !gated(key) ? put(key, value) : swap(key, (cur) => (cur != null && cur !== value && cur !== base.get(key) ? (mergeText(key, value, cur) ?? value) : value));

  /** The write to IndexedDB, in order. A failure keeps the value in localStorage if it fits, and is said out loud. */
  const queue = (key, value) => {
    waiting.set(key, value);
    tail = tail.then(async () => {
      if (!waiting.has(key) || waiting.get(key) !== value) return; // a newer write of this key follows
      try {
        if (value != null && gated(key)) flying.set(key, value);
        const out = await store1(key, value).finally(() => flying.delete(key));
        const newer = waiting.get(key) !== value;
        if (!newer) waiting.delete(key);
        if (gated(key)) {
          if (out == null) base.delete(key);
          else if (out === value) base.set(key, out);
          else if (newer) base.delete(key); // the newer write must merge too
          else {
            // Another window's records were merged in: this window shows them too.
            base.set(key, out);
            cache.set(key, out);
            announce(key);
          }
        }
        safeDel(PENDING + key);
        safeDel(PENDING_BASE + key);
        if (!stay.has(key) && !gated(key)) safeDel(key);
        opts.channel?.postMessage({ key });
        failed.delete(key);
      } catch (e) {
        waiting.delete(key);
        // Not lost: back to localStorage, as before this store existed.
        try {
          if (value == null) local.removeItem(key);
          else local.setItem(key, value);
          stay.add(key);
          if (value != null) last.set(key, value);
          cache.delete(key);
          failed.delete(key);
          fail(`This device's bigger storage refused a write, so "${key}" is kept in the small one`, e);
        } catch (e2) {
          failed.set(key, new Error(`This device's storage is full (${String(e2?.name ?? e2)})`));
          fail(`"${key}" could not be stored on this device`, e2);
        }
      }
    });
  };

  /**
   * A copy found in localStorage (an old one, one an older tab wrote later, or a write that was
   * on its way when the page closed): into IndexedDB, read back, compared, and only then removed.
   * Money's data is merged with what IndexedDB already holds; the sync's copies take the later one.
   */
  const absorb = async (key, from = key, keep = false) => {
    const found = safeGet(from);
    if (found == null) return;
    if (keep && taken.get(key) === found) return; // this very copy was taken in already
    if (!gated(key) && touched.has(key)) return; // written here since: that one is newer
    try {
      let unmerged = false;
      const next = !gated(key)
        ? await put(key, found)
        : await swap(key, (disk, os) => {
            if (disk == null || disk === found) return found;
            // A write that was on its way when the page closed, and nothing else was written since: it simply lands.
            if (from !== key && (safeGet(PENDING_BASE + key) || '').split('|').includes(textMark(disk))) return found;
            const merged = mergeText(key, disk, found);
            if (merged != null) return merged;
            // Sealed (or unreadable) data can't be merged: the later copy is used, the other is kept.
            os.put(disk, key + KEPT);
            unmerged = true;
            return found;
          });
      if (unmerged) fail(`Two copies of "${key}" were found on this device. The later one is in use; the other is kept as "${key}${KEPT}"`, 'they could not be merged');
      if ((await read(key)) !== next) throw new Error('the copy read back is not the copy written');
      // A copy another page wrote while this one runs stays where that page expects it (an older tab
      // would write it again, and again); it is removed on the next start, after being taken in once more.
      if (keep) taken.set(key, found);
      else if (safeGet(from) === found) safeDel(from);
      if (from !== key) safeDel(PENDING_BASE + key);
      stay.delete(key);
      last.delete(key);
      if (waiting.has(key)) base.delete(key); // a write is waiting here: it merges with this
      else {
        cache.set(key, next);
        if (gated(key)) base.set(key, next);
      }
      opts.channel?.postMessage({ key });
      announce(key);
    } catch (e) {
      if (from !== key || keep) return; // the copy stays where it is for the next start
      stay.add(key);
      last.set(key, found);
      cache.delete(key);
      fail(`"${key}" could not be moved to the bigger storage and stays where it was`, e);
    }
  };
  const names = () => {
    const out = [];
    try {
      for (let i = 0; i < local.length; i++) {
        const k = local.key(i);
        if (k) out.push(k);
      }
    } catch {
      /* no listing: nothing to move */
    }
    return out;
  };
  /** Every old copy that may move now. */
  const absorbAll = async () => {
    for (const key of names()) if (big(key) && may(key)) await absorb(key);
  };

  const ready = (async () => {
    if (!idb) {
      error = 'IndexedDB is not available here, so the big copies stay in the small storage';
      return;
    }
    try {
      const opened = await openDb();
      const tx = opened.transaction(STORE);
      const [keys, values] = await Promise.all([req(tx.objectStore(STORE).getAllKeys()), req(tx.objectStore(STORE).getAll())]);
      db = opened;
      keys.forEach((k, i) => {
        if (typeof k !== 'string' || typeof values[i] !== 'string' || !big(k)) return;
        // Money's data is already here: the new Money has started on this device before.
        if (gated(k)) {
          marked = true;
          base.set(k, values[i]);
        }
        if (!touched.has(k)) cache.set(k, values[i]);
      });
      mode = 'indexeddb';
    } catch (e) {
      db = null;
      fail('IndexedDB is not available here, so the big copies stay in the small storage', e);
      return;
    }
    // A write that was on its way when the page closed last time.
    for (const k of names()) {
      if (!k.startsWith(PENDING)) continue;
      const key = k.slice(PENDING.length);
      if (!big(key)) safeDel(k);
      else if (gated(key)) {
        if (may(key)) await absorb(key, k);
      } else {
        const v = safeGet(k);
        if (v != null && !touched.has(key)) {
          cache.set(key, v);
          queue(key, v);
        } else safeDel(k);
      }
    }
    // Old copies still in localStorage: moved over, checked, and only then removed there.
    await absorbAll();
    await tail;
  })();

  /** In line behind the writes, so the two never cross. */
  const soak = (key) => {
    tail = tail.then(() => (inIdb(key) || (stay.has(key) && db && may(key)) ? absorb(key, key, true) : undefined)).catch(() => {});
    return tail;
  };
  /** A copy in localStorage that has not been taken in yet. */
  const fresh = (key) => {
    const v = safeGet(key);
    return v != null && taken.get(key) !== v;
  };

  if (opts.channel) {
    opts.channel.onmessage = (e) => {
      const key = e?.data?.key;
      if (typeof key !== 'string' || !db || !big(key)) return;
      if (gated(key)) marked = true; // another window moved Money over
      if (may(key) && fresh(key)) return void soak(key); // a copy is still in the small storage here: both count
      if (waiting.has(key)) return;
      void read(key).then(
        (v) => {
          if (waiting.has(key)) return;
          const was = cache.has(key) ? cache.get(key) : null;
          stay.delete(key);
          last.delete(key);
          if (v == null) {
            cache.delete(key);
            base.delete(key);
          } else {
            cache.set(key, v);
            if (gated(key)) base.set(key, v);
          }
          if (was !== v) announce(key);
        },
        () => {}
      );
    };
  }
  if (ownWin && typeof ownWin.addEventListener === 'function') {
    // Leaving the page with a write still on its way: keep it where a closing page can.
    ownWin.addEventListener('pagehide', () => {
      for (const [key, value] of waiting) {
        if (value == null) continue;
        try {
          local.setItem(PENDING + key, value);
          if (gated(key)) local.setItem(PENDING_BASE + key, [base.get(key), flying.get(key)].filter((t) => typeof t === 'string').map(textMark).join('|'));
        } catch {
          // Too big for the small storage: hand it to IndexedDB once more and ask for the commit now.
          try {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.commit?.();
          } catch {
            /* the write already on its way usually still finishes */
          }
        }
      }
    });
    // An older tab (or a write that could not go to IndexedDB) put a copy in localStorage: take it in.
    ownWin.addEventListener('storage', (e) => {
      const key = e?.key;
      if (typeof key !== 'string' || e.newValue == null || e.storageArea !== local || !big(key)) return;
      if (db && may(key)) void soak(key);
    });
  }

  /** IndexedDB is still being opened: a write is kept in memory and stored once it answers. */
  const opening = (key) => may(key) && !!idb && db == null && mode === 'localStorage' && !error;
  const getItem = (key) => {
    if (!big(key)) return local.getItem(key);
    if (!may(key)) {
      const v = local.getItem(key);
      if (v != null) last.set(key, v);
      return v;
    }
    if (cache.has(key)) return cache.get(key);
    // Removed here, or never there. An old copy still in localStorage (not moved yet, or kept there) is read as it is.
    if (touched.has(key) && inIdb(key)) return null;
    const v = safeGet(key);
    if (v != null) {
      if (gated(key)) last.set(key, v);
      return v;
    }
    // Another window has just moved it to IndexedDB and this one has not loaded it yet.
    return mode === 'indexeddb' && db && last.has(key) ? last.get(key) : null;
  };
  const setItem = (key, value, from = null, own = local) => {
    if (!big(key)) return own.setItem(key, value);
    const text = String(value);
    if (!inIdb(key) && !opening(key)) {
      // No IndexedDB, or not moved yet: exactly as before (a full storage throws, as before).
      own.setItem(key, text);
      if (may(key) || gated(key)) last.set(key, text);
      return;
    }
    touched.add(key);
    cache.set(key, text);
    last.delete(key);
    announce(key, from);
    if (db) queue(key, text);
    else {
      waiting.set(key, text);
      void ready.then(() => {
        if (cache.get(key) !== text || waiting.get(key) !== text) return;
        if (db) return queue(key, text);
        // IndexedDB turned out not to be there: the small storage, as before.
        waiting.delete(key);
        cache.delete(key);
        try {
          local.setItem(key, text);
        } catch (e) {
          cache.set(key, text);
          failed.set(key, new Error(`This device's storage is full (${String(e?.name ?? e)})`));
          fail(`"${key}" could not be stored on this device`, e);
        }
      });
    }
  };
  const removeItem = (key, from = null, own = local) => {
    if (!big(key)) return own.removeItem(key);
    last.delete(key);
    // No IndexedDB, or not moved yet: exactly as before.
    if (!may(key) || (!db && !opening(key))) return own.removeItem(key);
    touched.add(key);
    cache.delete(key);
    stay.delete(key);
    try {
      own.removeItem(key);
    } catch {
      /* private window */
    }
    safeDel(PENDING + key);
    safeDel(PENDING_BASE + key);
    announce(key, from);
    if (db) queue(key, null);
    else {
      waiting.set(key, null);
      void ready.then(() => {
        if (cache.has(key) || waiting.get(key) !== null) return;
        if (db) queue(key, null);
        else waiting.delete(key);
      });
    }
  };
  const flush = async () => {
    await ready.catch(() => {});
    let seen;
    do {
      seen = tail;
      await seen;
    } while (seen !== tail);
    const first = failed.values().next().value;
    if (first) throw first;
  };
  /**
   * The new Money has started on this device: its data may leave localStorage now.
   * Resolves once it is in IndexedDB and checked (or stays where it was, with the reason in status()).
   */
  const moveIn = async () => {
    marked = true;
    try {
      if (safeGet(mark) !== 'idb') local.setItem(mark, 'idb');
    } catch {
      /* private window: the mark lasts as long as this window */
    }
    await ready.catch(() => {});
    if (!db) return;
    tail = tail.then(absorbAll).catch(() => {});
    await tail;
  };
  const status = () => {
    const keys = [...cache].map(([key, v]) => ({ key, chars: v.length, where: 'indexeddb' }));
    for (const k of names()) if (big(k) && !cache.has(k)) keys.push({ key: k, chars: (safeGet(k) ?? '').length, where: 'localStorage' });
    return { mode, error, keys, moneyMoved: gateOpen() };
  };

  /** The window's own localStorage (for keys that are not kept here, so its `storage` events go out as they always did). */
  const ownOf = (win) => {
    try {
      return win?.localStorage ?? local;
    } catch {
      return local;
    }
  };
  const face = (from) => ({
    ready,
    flush,
    status,
    moveIn,
    getItem,
    setItem: (key, value) => setItem(key, value, from, ownOf(from)),
    removeItem: (key) => removeItem(key, from, ownOf(from)),
    clear: () => local.clear(),
    key: (i) => local.key(i),
    get length() {
      return local.length;
    },
    /** The same store for another window on this page (the Money frame): it hears the others' changes, not its own. */
    forWindow(win) {
      if (!win) return store;
      let f = facades.get(win);
      if (!f) {
        f = face(win);
        facades.set(win, f);
      }
      // A window keeps its identity when its page is reloaded (the Money frame): each new page listens again.
      let page = win;
      try {
        page = win.document ?? win;
      } catch {
        /* blocked: one page as far as we can tell */
      }
      if (pages.get(win) !== page) {
        pages.set(win, page);
        windows.add(win);
        try {
          win.addEventListener('pagehide', () => pages.get(win) === page && windows.delete(win));
          win.addEventListener('pageshow', () => pages.get(win) === page && windows.add(win));
        } catch {
          /* a window that can't be listened to is dropped on its first failed event */
        }
      }
      return f;
    }
  });
  const store = face(null);
  return store;
}

/** Money's own merge, for `createBigStore({ merge })`: (mergeLocal, normalizeState) from sync.js and model.js. */
export const moneyMerge = (mergeLocal, normalizeState) => (key, mine, theirs) =>
  key === MONEY_KEY ? JSON.stringify(mergeLocal(normalizeState(JSON.parse(mine)), normalizeState(JSON.parse(theirs)))) : null;
