import { describe, expect, it, vi } from 'vitest';
import { SyncEngine, emptyOutbox, mergeItems, type Outbox, type Result, type SyncDeps } from '@/lib/client/sync';
import type { PushBody, PushResult } from '@/lib/shared/types';
import { DEFAULT_SETTINGS } from '@/lib/shared/types';
import { later, makeItem } from '../helpers/fixtures';

function memoryStore() {
  let saved: Outbox | null = null;
  return {
    load: async () => saved,
    save: async (ob: Outbox) => {
      saved = JSON.parse(JSON.stringify(ob));
    },
    get saved() {
      return saved;
    },
  };
}

function engine(push: (b: PushBody) => Promise<Result<PushResult>>) {
  const store = memoryStore();
  const statuses: string[] = [];
  const sleeps: number[] = [];
  const deps: SyncDeps = {
    push,
    pull: async () => ({ ok: true, data: { items: [], entries: [], notes: [], settings: null, chat: null, cursor: 'c' } }),
    store,
    onStatus: (s) => statuses.push(s),
    onPushed: () => {},
    onPulled: () => {},
    onUnauthorized: vi.fn(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  const e = new SyncEngine(deps, 'c0');
  return { e, store, statuses, sleeps, deps };
}

const ok = (b: PushBody): Result<PushResult> => ({ ok: true, data: { items: b.items ?? [], entries: b.entries ?? [], notes: b.notes ?? [], settings: DEFAULT_SETTINGS } });
const offline: Result<PushResult> = { ok: false, status: 0 };

describe('SyncEngine', () => {
  it('saves: Saving… then All changes saved, outbox empty', async () => {
    const push = vi.fn(async (b: PushBody) => ok(b));
    const { e, statuses, store } = engine(push);
    e.queueItem(makeItem({ title: 'a' }));
    await e.flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['saving', 'saved']);
    expect(e.isEmpty()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(store.saved!.items)).toEqual([]);
  });

  it('a failed save is retried once after 0.5–1 s, then shows "error" and stays queued', async () => {
    const push = vi.fn(async () => offline);
    const { e, statuses, sleeps, store } = engine(push);
    const it0 = makeItem({ title: 'precious' });
    e.queueItem(it0);
    await e.flush();
    expect(push).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(500);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);
    expect(statuses.at(-1)).toBe('error');
    expect(e.isEmpty()).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.saved!.items[it0.id].title).toBe('precious');
  });

  it('when the connection comes back, the queued change is saved', async () => {
    let online = false;
    const push = vi.fn(async (b: PushBody) => (online ? ok(b) : offline));
    const { e, statuses } = engine(push);
    e.queueItem(makeItem());
    await e.flush();
    expect(e.status).toBe('error');
    online = true;
    await e.flush();
    expect(e.status).toBe('saved');
    expect(statuses.at(-1)).toBe('saved');
    expect(e.isEmpty()).toBe(true);
  });

  it('edits made while a save is in flight are not lost', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const push = vi.fn(async (b: PushBody) => {
      sent.push(b.items![0].title);
      if (sent.length === 1) await gate;
      return ok(b);
    });
    const { e } = engine(push);
    const a = makeItem({ title: 'v1' });
    e.queueItem(a);
    const p = e.flush();
    await Promise.resolve();
    e.queueItem({ ...a, title: 'v2', updatedAt: later(a.updatedAt) });
    release();
    await p;
    await e.flush();
    expect(sent).toEqual(['v1', 'v2']);
    expect(e.isEmpty()).toBe(true);
  });

  it('coalesces repeated edits to the same item into one entry', () => {
    const { e } = engine(async (b) => ok(b));
    const a = makeItem({ title: 'a' });
    e.queueItem(a);
    e.queueItem({ ...a, title: 'b' });
    e.queueItem({ ...a, title: 'c' });
    expect(Object.values(e.snapshotOutbox().items).map((x) => x.title)).toEqual(['c']);
  });

  it('a 401 pauses saving and asks for the password, keeping the change', async () => {
    const push = vi.fn(async (): Promise<Result<PushResult>> => ({ ok: false, status: 401 }));
    const { e, deps } = engine(push);
    e.queueItem(makeItem());
    await e.flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(deps.onUnauthorized).toHaveBeenCalled();
    expect(e.isEmpty()).toBe(false);
  });

  it('restores changes queued by an earlier visit', async () => {
    const it0 = makeItem({ title: 'made offline' });
    const store = { load: async () => ({ ...emptyOutbox(), items: { [it0.id]: it0 } }), save: async () => {} };
    const e = new SyncEngine(
      {
        push: async (b) => ok(b),
        pull: async () => ({ ok: true, data: { items: [], entries: [], notes: [], settings: null, chat: null, cursor: 'c' } }),
        store,
        onStatus: () => {},
        onPushed: () => {},
        onPulled: () => {},
        onUnauthorized: () => {},
      },
      'c0',
    );
    const ob = await e.restore();
    expect(ob.items[it0.id].title).toBe('made offline');
    expect(e.isEmpty()).toBe(false);
  });
});

describe('mergeItems (newest wins)', () => {
  it('takes newer, ignores older, removes deleted, skips pending', () => {
    const a = makeItem({ title: 'a' });
    const b = makeItem({ title: 'b' });
    const c = makeItem({ title: 'c' });
    const cur = { [a.id]: a, [b.id]: b, [c.id]: c };
    const next = mergeItems(cur, [
      { ...a, title: 'a2', updatedAt: later(a.updatedAt) },
      { ...b, title: 'b-old', updatedAt: later(b.updatedAt, -5000) },
      { ...c, deletedAt: later(c.updatedAt), updatedAt: later(c.updatedAt) },
    ]);
    expect(next[a.id].title).toBe('a2');
    expect(next[b.id].title).toBe('b');
    expect(next[c.id]).toBeUndefined();
    const skipped = mergeItems(cur, [{ ...a, title: 'remote', updatedAt: later(a.updatedAt) }], new Set([a.id]));
    expect(skipped[a.id].title).toBe('a');
  });
});
