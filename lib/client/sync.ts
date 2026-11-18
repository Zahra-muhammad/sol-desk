import type { Alarm, DeskDelta, Item, Note, PushBody, PushResult, SettingsPatch, TimeEntry, WinLayout } from '@/lib/shared/types';

export type SaveStatus = 'saved' | 'saving' | 'error';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error?: string; retryAfter?: number };

/** Records that sync with "newest updatedAt wins" and soft deletes. */
export type Synced = { id: string; updatedAt: string; deletedAt: string | null };

/** The synced collections, keyed the same way in the outbox, push body and delta. */
export const COLLECTIONS = ['items', 'entries', 'notes', 'alarms'] as const;
export type Collection = (typeof COLLECTIONS)[number];
export interface CollectionTypes {
  items: Item;
  entries: TimeEntry;
  notes: Note;
  alarms: Alarm;
}

/** Changes that haven't reached the server yet. Coalesced: one entry per record / setting / window. */
export interface Outbox {
  items: Record<string, Item>;
  entries: Record<string, TimeEntry>;
  notes: Record<string, Note>;
  alarms: Record<string, Alarm>;
  settings: SettingsPatch;
  layout: Record<string, WinLayout>;
}

export const emptyOutbox = (): Outbox => ({ items: {}, entries: {}, notes: {}, alarms: {}, settings: {}, layout: {} });

export interface OutboxStore {
  load(): Promise<Outbox | null>;
  save(ob: Outbox): Promise<void>;
  /** Synchronous last-chance copy while the page is unloading. */
  saveNow?(ob: Outbox): void;
}

export interface SyncDeps {
  push(body: PushBody): Promise<Result<PushResult>>;
  pull(since: string): Promise<Result<DeskDelta>>;
  /** Fire-and-forget send that survives page unload (fetch keepalive). */
  beacon?(body: PushBody): void;
  store: OutboxStore;
  onStatus(s: SaveStatus): void;
  onPushed(res: PushResult, pending: Pending): void;
  onPulled(delta: DeskDelta, pending: Pending): void;
  onUnauthorized(): void;
  sleep?(ms: number): Promise<void>;
  random?(): number;
}

export interface Pending {
  items: Set<string>;
  entries: Set<string>;
  notes: Set<string>;
  alarms: Set<string>;
  settings: Set<string>;
}

const MAX_BATCH = 400;

export class SyncEngine {
  status: SaveStatus = 'saved';
  cursor: string;
  /** While the screen is locked the server refuses data calls; changes stay queued. */
  paused = false;

  private ob: Outbox = emptyOutbox();
  private inflight: Promise<void> | null = null;
  private again = false;
  private pulling = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private d: SyncDeps,
    cursor: string,
  ) {
    this.cursor = cursor;
  }

  /** Load changes queued by an earlier visit (e.g. made offline) and return them so the UI can re-apply them. */
  async restore(): Promise<Outbox> {
    const saved = await this.d.store.load().catch(() => null);
    if (saved) {
      for (const c of COLLECTIONS) {
        const into = this.ob[c] as Record<string, Synced>;
        for (const [id, rec] of Object.entries((saved[c] || {}) as Record<string, Synced>)) {
          const cur = into[id];
          if (!cur || cur.updatedAt < rec.updatedAt) into[id] = rec;
        }
      }
      this.ob.settings = { ...(saved.settings || {}), ...this.ob.settings };
      this.ob.layout = { ...(saved.layout || {}), ...this.ob.layout };
    }
    return this.snapshotOutbox();
  }

  /** Queue a changed item, time entry or note. */
  queue<C extends Collection>(c: C, rec: CollectionTypes[C]) {
    (this.ob[c] as Record<string, Synced>)[rec.id] = rec;
    this.changed();
  }

  queueItem(it: Item) {
    this.queue('items', it);
  }

  queueSettings(patch: SettingsPatch) {
    this.ob.settings = { ...this.ob.settings, ...patch };
    this.changed();
  }

  queueLayout(list: WinLayout[]) {
    for (const l of list) this.ob.layout[l.key] = l;
    this.changed();
  }

  isEmpty() {
    return COLLECTIONS.every((c) => !Object.keys(this.ob[c]).length) && !Object.keys(this.ob.settings).length && !Object.keys(this.ob.layout).length;
  }

  pending(): Pending {
    return {
      items: new Set(Object.keys(this.ob.items)),
      entries: new Set(Object.keys(this.ob.entries)),
      notes: new Set(Object.keys(this.ob.notes)),
      alarms: new Set(Object.keys(this.ob.alarms)),
      settings: new Set(Object.keys(this.ob.settings)),
    };
  }

  snapshotOutbox(): Outbox {
    return {
      items: { ...this.ob.items },
      entries: { ...this.ob.entries },
      notes: { ...this.ob.notes },
      alarms: { ...this.ob.alarms },
      settings: { ...this.ob.settings },
      layout: { ...this.ob.layout },
    };
  }

  /** Push everything queued. Retries once after 0.5–1 s; after that the change stays queued and status is "error". */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    this.inflight = this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Fetch what changed on the server since the last pull (other devices, the planner). */
  async pull(): Promise<void> {
    if (this.paused || this.pulling) return;
    this.pulling = true;
    try {
      const r = await this.d.pull(this.cursor);
      if (r.ok) {
        this.cursor = r.data.cursor;
        this.d.onPulled(r.data, this.pending());
      } else if (r.status === 401) {
        this.d.onUnauthorized();
      }
    } finally {
      this.pulling = false;
    }
    if (!this.isEmpty()) void this.flush();
  }

  /** Page is going away: keep a synchronous copy and send what we can. */
  flushOnUnload() {
    if (this.isEmpty()) return;
    this.d.store.saveNow?.(this.ob);
    if (!this.paused) this.d.beacon?.(this.bodyOf(this.snapshotOutbox()));
  }

  // ---- internals ----

  private changed() {
    this.persist();
    if (this.timer || this.paused) return;
    // Coalesce bursts (typing, dragging) into one request.
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 40);
  }

  private persist() {
    const copy = this.snapshotOutbox();
    this.saving = this.saving.then(() => this.d.store.save(copy)).catch(() => {});
  }

  private setStatus(s: SaveStatus) {
    if (this.status === s) return;
    this.status = s;
    this.d.onStatus(s);
  }

  private bodyOf(ob: Outbox): PushBody {
    const body: PushBody = {};
    for (const c of COLLECTIONS) {
      const list = Object.values(ob[c]);
      if (list.length) (body as Record<string, unknown>)[c] = list;
    }
    if (Object.keys(ob.settings).length) body.settings = ob.settings;
    const layout = Object.values(ob.layout);
    if (layout.length) body.layout = layout;
    return body;
  }

  private async run() {
    const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const random = this.d.random ?? Math.random;
    do {
      this.again = false;
      if (this.paused || this.isEmpty()) break;

      // Snapshot by reference so edits made during the request aren't lost.
      const all = this.snapshotOutbox();
      const snap: Outbox = { ...all };
      let room = MAX_BATCH;
      for (const c of COLLECTIONS) {
        const ids = Object.keys(all[c]).slice(0, Math.max(0, room));
        room -= ids.length;
        (snap as unknown as Record<Collection, Record<string, Synced>>)[c] = Object.fromEntries(
          ids.map((id) => [id, (all[c] as Record<string, Synced>)[id]]),
        );
      }
      const body = this.bodyOf(snap);

      this.setStatus('saving');
      let r = await this.d.push(body);
      if (!r.ok && r.status !== 401) {
        await sleep(500 + random() * 500);
        r = await this.d.push(body);
      }
      if (!r.ok) {
        this.setStatus('error');
        if (r.status === 401) this.d.onUnauthorized();
        return;
      }

      for (const c of COLLECTIONS) {
        const live = this.ob[c] as Record<string, Synced>;
        for (const [id, rec] of Object.entries(snap[c] as Record<string, Synced>)) if (live[id] === rec) delete live[id];
      }
      for (const [k, v] of Object.entries(snap.settings)) {
        if ((this.ob.settings as Record<string, unknown>)[k] === v) delete (this.ob.settings as Record<string, unknown>)[k];
      }
      for (const [k, v] of Object.entries(snap.layout)) if (this.ob.layout[k] === v) delete this.ob.layout[k];
      this.persist();
      this.d.onPushed(r.data, this.pending());
    } while (this.again || (!this.isEmpty() && !this.paused));

    if (this.isEmpty()) this.setStatus('saved');
  }
}

/**
 * Newest `updatedAt` wins. Works for items, time entries and notes.
 * Returns the merged map (a new object only if something changed).
 */
export function mergeById<T extends Synced>(current: Record<string, T>, incoming: T[] | undefined, skip?: Set<string>): Record<string, T> {
  let next = current;
  for (const it of incoming ?? []) {
    if (skip?.has(it.id)) continue;
    const cur = current[it.id];
    if (cur && cur.updatedAt > it.updatedAt) continue;
    if (it.deletedAt) {
      if (!cur) continue;
      if (next === current) next = { ...current };
      delete next[it.id];
    } else {
      if (cur && cur.updatedAt === it.updatedAt && JSON.stringify(cur) === JSON.stringify(it)) continue;
      if (next === current) next = { ...current };
      next[it.id] = it;
    }
  }
  return next;
}

/** Kept for readability at call sites that deal only with items. */
export const mergeItems = mergeById<Item>;
