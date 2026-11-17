import type { DeskDelta, Item, PushBody, PushResult, SettingsPatch, WinLayout } from '@/lib/shared/types';

export type SaveStatus = 'saved' | 'saving' | 'error';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error?: string; retryAfter?: number };

/** Changes that haven't reached the server yet. Coalesced: one entry per item / setting / window. */
export interface Outbox {
  items: Record<string, Item>;
  settings: SettingsPatch;
  layout: Record<string, WinLayout>;
}

export const emptyOutbox = (): Outbox => ({ items: {}, settings: {}, layout: {} });

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
  onPushed(res: PushResult): void;
  onPulled(delta: DeskDelta, pending: Pending): void;
  onUnauthorized(): void;
  sleep?(ms: number): Promise<void>;
  random?(): number;
}

export interface Pending {
  items: Set<string>;
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
      for (const [id, it] of Object.entries(saved.items || {})) {
        const cur = this.ob.items[id];
        if (!cur || cur.updatedAt < it.updatedAt) this.ob.items[id] = it;
      }
      this.ob.settings = { ...(saved.settings || {}), ...this.ob.settings };
      this.ob.layout = { ...(saved.layout || {}), ...this.ob.layout };
    }
    return this.snapshotOutbox();
  }

  queueItem(it: Item) {
    this.ob.items[it.id] = it;
    this.changed();
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
    return !Object.keys(this.ob.items).length && !Object.keys(this.ob.settings).length && !Object.keys(this.ob.layout).length;
  }

  pending(): Pending {
    return { items: new Set(Object.keys(this.ob.items)), settings: new Set(Object.keys(this.ob.settings)) };
  }

  snapshotOutbox(): Outbox {
    return { items: { ...this.ob.items }, settings: { ...this.ob.settings }, layout: { ...this.ob.layout } };
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
    const items = Object.values(ob.items);
    if (items.length) body.items = items;
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
      const ids = Object.keys(all.items).slice(0, MAX_BATCH);
      const snap: Outbox = {
        items: Object.fromEntries(ids.map((id) => [id, all.items[id]])),
        settings: all.settings,
        layout: all.layout,
      };
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

      for (const [id, it] of Object.entries(snap.items)) if (this.ob.items[id] === it) delete this.ob.items[id];
      for (const [k, v] of Object.entries(snap.settings)) {
        if ((this.ob.settings as Record<string, unknown>)[k] === v) delete (this.ob.settings as Record<string, unknown>)[k];
      }
      for (const [k, v] of Object.entries(snap.layout)) if (this.ob.layout[k] === v) delete this.ob.layout[k];
      this.persist();
      this.d.onPushed(r.data);
    } while (this.again || (!this.isEmpty() && !this.paused));

    if (this.isEmpty()) this.setStatus('saved');
  }
}

/** Newest `updatedAt` wins. Returns the merged map (new object only if something changed). */
export function mergeItems(
  current: Record<string, Item>,
  incoming: Item[],
  skip?: Set<string>,
): Record<string, Item> {
  let next = current;
  for (const it of incoming) {
    if (skip?.has(it.id)) continue;
    const cur = current[it.id];
    if (cur && cur.updatedAt > it.updatedAt) continue;
    if (it.deletedAt) {
      if (!cur) continue;
      if (next === current) next = { ...current };
      delete next[it.id];
    } else {
      if (cur && sameItem(cur, it)) continue;
      if (next === current) next = { ...current };
      next[it.id] = it;
    }
  }
  return next;
}

function sameItem(a: Item, b: Item) {
  return (
    a.updatedAt === b.updatedAt &&
    a.title === b.title &&
    a.done === b.done &&
    a.date === b.date &&
    a.time === b.time &&
    a.notes === b.notes &&
    a.project === b.project &&
    a.type === b.type &&
    a.month === b.month &&
    a.dur === b.dur &&
    a.with === b.with &&
    a.link === b.link
  );
}
