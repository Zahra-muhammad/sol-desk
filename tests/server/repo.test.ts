import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '@/lib/server/db/connect';
import { chatMessages, items } from '@/lib/server/db/schema';
import {
  addChat,
  clearChat,
  exportAll,
  getDelta,
  getItem,
  getSettings,
  getState,
  importBackup,
  liveItems,
  patchSettings,
  pushItems,
  putLayout,
} from '@/lib/server/repo';
import { later, makeItem } from '../helpers/fixtures';

let db: DB;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await openDb('pglite:memory', { migrate: true }));
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(items);
  await db.delete(chatMessages);
});

describe('save', () => {
  it('creates and reads back an item with every field intact', async () => {
    const it0 = makeItem({ type: 'meeting', title: 'Design review', date: '2026-11-18', time: '11:00', dur: 45, project: 'p1', with: 'Ali', link: 'zoom.us/x', notes: 'bring mockups' });
    const [saved] = await pushItems(db, [it0]);
    expect(saved).toEqual(it0);
    expect(await getItem(db, it0.id)).toEqual(it0);
  });

  it('applies a newer edit', async () => {
    const a = makeItem({ title: 'v1' });
    await pushItems(db, [a]);
    const b = { ...a, title: 'v2', done: true, updatedAt: later(a.updatedAt) };
    const [saved] = await pushItems(db, [b]);
    expect(saved.title).toBe('v2');
    expect(saved.done).toBe(true);
  });

  it('ignores an older edit — the newest updated_at wins', async () => {
    const a = makeItem({ title: 'newest' });
    await pushItems(db, [a]);
    const stale = { ...a, title: 'stale', updatedAt: later(a.updatedAt, -60_000) };
    const [saved] = await pushItems(db, [stale]);
    expect(saved.title).toBe('newest');
  });

  it('does not let a client clock push an edit far into the future', async () => {
    const a = makeItem({ updatedAt: new Date(Date.now() + 365 * 864e5).toISOString() });
    const [saved] = await pushItems(db, [a]);
    expect(Date.parse(saved.updatedAt)).toBeLessThanOrEqual(Date.now() + 61_000);
  });
});

describe('delete and undo', () => {
  it('soft-deletes: gone from the desk, kept in the database', async () => {
    const a = makeItem({ title: 'to delete' });
    await pushItems(db, [a]);
    const t = later(a.updatedAt);
    await pushItems(db, [{ ...a, deletedAt: t, updatedAt: t }]);
    expect((await liveItems(db)).map((x) => x.id)).not.toContain(a.id);
    expect((await getItem(db, a.id))?.deletedAt).toBe(t);
  });

  it('undo brings the item back exactly as it was', async () => {
    const a = makeItem({ title: 'oops', notes: 'keep me' });
    await pushItems(db, [a]);
    const t1 = later(a.updatedAt);
    await pushItems(db, [{ ...a, deletedAt: t1, updatedAt: t1 }]);
    const t2 = later(t1);
    await pushItems(db, [{ ...a, deletedAt: null, updatedAt: t2 }]);
    const back = (await liveItems(db)).find((x) => x.id === a.id);
    expect(back).toMatchObject({ title: 'oops', notes: 'keep me', deletedAt: null });
  });

  it('"clear finished to-dos" can be undone', async () => {
    const done = [makeItem({ done: true, title: 'a' }), makeItem({ done: true, title: 'b' })];
    const open = makeItem({ title: 'still open' });
    await pushItems(db, [...done, open]);
    const t = later(done[0].updatedAt);
    await pushItems(db, done.map((x) => ({ ...x, deletedAt: t, updatedAt: t })));
    expect((await liveItems(db)).map((x) => x.title)).toEqual(['still open']);
    const t2 = later(t);
    await pushItems(db, done.map((x) => ({ ...x, deletedAt: null, updatedAt: t2 })));
    expect((await liveItems(db)).map((x) => x.title).sort()).toEqual(['a', 'b', 'still open']);
  });

  it('a delete reaches other devices through the delta', async () => {
    const a = makeItem();
    await pushItems(db, [a]);
    const { cursor } = await getState(db);
    const t = later(a.updatedAt);
    await pushItems(db, [{ ...a, deletedAt: t, updatedAt: t }]);
    const d = await getDelta(db, new Date(cursor));
    expect(d.items.find((x) => x.id === a.id)?.deletedAt).toBe(t);
  });
});

describe('settings, chat, layout', () => {
  it('patches only the fields sent', async () => {
    await patchSettings(db, { p1Name: 'Atlas' });
    await patchSettings(db, { p2Notes: 'ship v2' });
    const s = await getSettings(db);
    expect(s.p1.name).toBe('Atlas');
    expect(s.p2.notes).toBe('ship v2');
    expect(s.theme).toBe('dark');
  });

  it('clearing the chat shows up in the delta', async () => {
    await addChat(db, 'user', 'hi');
    const { cursor } = await getState(db);
    await clearChat(db);
    const d = await getDelta(db, new Date(cursor));
    expect(d.chat).toEqual([]);
  });
});

describe('export and import', () => {
  it('round-trips everything into an empty desk', async () => {
    const a = makeItem({ title: 'Plan launch', date: '2026-12-01', project: 'p2', notes: 'n' });
    const b = makeItem({ type: 'event', title: 'Gym', date: '2026-11-20', time: '07:00', dur: 60 });
    await pushItems(db, [a, b]);
    await patchSettings(db, { p1Name: 'Atlas', p2Name: 'Bloom', theme: 'light' });
    await addChat(db, 'user', 'Plan my day');
    await addChat(db, 'assistant', 'Here you go', 0);
    await putLayout(db, [{ key: 'today', x: 10, y: 20, w: 350, h: 470, open: true, z: 0 }]);

    const backup = JSON.parse(JSON.stringify(await exportAll(db)));
    expect(backup.app).toBe('sol-desk');
    expect(backup.items).toHaveLength(2);

    const other = await openDb('pglite:memory', { migrate: true });
    try {
      const res = await importBackup(other.db, backup);
      expect(res).toEqual({ items: 2, entries: 0, notes: 0, skipped: 0 });
      const st = await getState(other.db);
      expect(st.items.map((x) => x.title).sort()).toEqual(['Gym', 'Plan launch']);
      expect(st.items.find((x) => x.title === 'Plan launch')).toMatchObject({ date: '2026-12-01', project: 'p2', notes: 'n' });
      expect(st.settings).toMatchObject({ p1: { name: 'Atlas' }, p2: { name: 'Bloom' }, theme: 'light' });
      expect(st.chat.map((m) => m.content)).toEqual(['Plan my day', 'Here you go']);
      expect(st.layout).toEqual([{ key: 'today', x: 10, y: 20, w: 350, h: 470, open: true, z: 0 }]);

      // Importing the same file twice doesn't duplicate anything.
      await importBackup(other.db, backup);
      const again = await getState(other.db);
      expect(again.items).toHaveLength(2);
      expect(again.chat).toHaveLength(2);
    } finally {
      await other.close();
    }
  });

  it('restoring a backup brings back items deleted after it was taken', async () => {
    const a = makeItem({ title: 'precious' });
    await pushItems(db, [a]);
    const backup = JSON.parse(JSON.stringify(await exportAll(db)));
    const t = later(a.updatedAt);
    await pushItems(db, [{ ...a, deletedAt: t, updatedAt: t }]);
    await importBackup(db, backup);
    expect((await liveItems(db)).map((x) => x.title)).toContain('precious');
  });

  it("imports the prototype's “Copy all my data” JSON", async () => {
    const proto = {
      items: [
        { id: 'iabc123', type: 'task', title: 'send invoice', date: '', time: '', dur: 0, project: 'p2', done: false, notes: '', with: '', created: 1763300000000 },
        { id: 'iabc124', type: 'meeting', title: 'call Ali', date: '2026-11-18', time: '15:00', dur: 30, project: '', done: true, doneAt: 1763300000000, notes: 'x', with: '', created: 1763300000000 },
        { id: 'bad id with spaces', type: 'task', title: 'skipped' },
      ],
      settings: { p1: { name: 'Atlas', notes: '' }, p2: { name: 'Bloom', notes: 'hi' } },
    };
    const res = await importBackup(db, proto);
    expect(res).toEqual({ items: 2, entries: 0, notes: 0, skipped: 1 });
    const live = await liveItems(db);
    expect(live.find((x) => x.id === 'iabc123')).toMatchObject({ date: null, time: null, project: 'p2' });
    expect(live.find((x) => x.id === 'iabc124')).toMatchObject({ project: null, done: true });
    expect((await getSettings(db)).p2.notes).toBe('hi');
  });

  it('rejects something that is not a backup', async () => {
    await expect(importBackup(db, { hello: 'world' })).rejects.toThrow(/items/);
  });
});
