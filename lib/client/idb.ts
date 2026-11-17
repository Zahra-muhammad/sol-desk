import { emptyOutbox, type Outbox, type OutboxStore } from './sync';

// The outbox lives in IndexedDB so a change made offline (or one whose save failed)
// survives a refresh, a crash or a closed tab. A localStorage copy is written
// synchronously on unload, because IndexedDB writes may not finish in time.

const DB_NAME = 'sol-desk';
const STORE = 'kv';
const KEY = 'outbox';
const LS_KEY = 'desk.outbox-unload';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbp = null;
      reject(req.error);
    };
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function mergeInto(a: Outbox, b: Partial<Outbox> | null | undefined): Outbox {
  if (!b) return a;
  for (const [id, it] of Object.entries(b.items || {})) {
    const cur = a.items[id];
    if (!cur || cur.updatedAt < it.updatedAt) a.items[id] = it;
  }
  a.settings = { ...a.settings, ...(b.settings || {}) };
  a.layout = { ...a.layout, ...(b.layout || {}) };
  return a;
}

export const idbOutbox: OutboxStore = {
  async load() {
    const out = emptyOutbox();
    try {
      mergeInto(out, (await tx('readonly', (s) => s.get(KEY))) as Outbox | undefined);
    } catch {
      /* private mode etc. — fall through to the localStorage copy */
    }
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        mergeInto(out, JSON.parse(raw));
        localStorage.removeItem(LS_KEY);
      }
    } catch {
      /* ignore */
    }
    return out;
  },
  async save(ob) {
    try {
      await tx('readwrite', (s) => s.put(ob, KEY));
    } catch {
      // IndexedDB unavailable: keep a synchronous copy instead.
      this.saveNow?.(ob);
    }
  },
  saveNow(ob) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ob));
    } catch {
      /* ignore */
    }
  },
};
