import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '@/lib/server/db/connect';
import { notes, timeEntries } from '@/lib/server/db/schema';
import { contextBlock } from '@/lib/server/planner';
import { exportAll, getDelta, getState, importBackup, liveNotes, pushEntries, pushNotes } from '@/lib/server/repo';
import { DEFAULT_SETTINGS, type Note, type TimeEntry } from '@/lib/shared/types';

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openDb('pglite:memory', { migrate: true }));
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(timeEntries);
  await db.delete(notes);
});

const later = (iso: string, ms = 1000) => new Date(Date.parse(iso) + ms).toISOString();
let n = 0;
const entry = (p: Partial<TimeEntry> = {}): TimeEntry => {
  const t = new Date().toISOString();
  return { id: 'tent' + ++n, label: 'Bazaar doc', project: 'p2', startedAt: t, endedAt: null, createdAt: t, updatedAt: t, deletedAt: null, ...p };
};
const note = (p: Partial<Note> = {}): Note => {
  const t = new Date().toISOString();
  return { id: 'note' + ++n, title: 'Ideas', body: 'first line\nsecond', createdAt: t, updatedAt: t, deletedAt: null, ...p };
};

describe('time entries', () => {
  it('saves a running timer, stops it, and the newest edit wins', async () => {
    const e = entry();
    const [saved] = await pushEntries(db, [e]);
    expect(saved).toEqual(e);
    const stopped = { ...e, endedAt: later(e.startedAt, 25 * 60e3), updatedAt: later(e.updatedAt) };
    await pushEntries(db, [stopped]);
    const [stale] = await pushEntries(db, [{ ...e, label: 'stale', updatedAt: later(e.updatedAt, -5000) }]);
    expect(stale.label).toBe('Bazaar doc');
    expect(stale.endedAt).toBe(stopped.endedAt);
  });

  it('a running timer is in the desk state; a delete reaches other devices', async () => {
    const e = entry();
    await pushEntries(db, [e]);
    const st = await getState(db);
    expect(st.entries.map((x) => x.id)).toEqual([e.id]);
    const t = later(e.updatedAt);
    await pushEntries(db, [{ ...e, deletedAt: t, updatedAt: t }]);
    const d = await getDelta(db, new Date(st.cursor));
    expect(d.entries.find((x) => x.id === e.id)?.deletedAt).toBe(t);
    expect((await getState(db)).entries).toEqual([]);
  });
});

describe('notebook', () => {
  it('saves, edits, lists newest first, and soft-deletes', async () => {
    const a = note({ title: 'A' });
    const b = note({ title: 'B', updatedAt: later(a.updatedAt, 5000) });
    await pushNotes(db, [a, b]);
    expect((await liveNotes(db)).map((x) => x.title)).toEqual(['B', 'A']);
    const t = later(b.updatedAt);
    await pushNotes(db, [{ ...a, body: 'edited', updatedAt: t }]);
    expect((await liveNotes(db))[0]).toMatchObject({ title: 'A', body: 'edited' });
    const t2 = later(t);
    await pushNotes(db, [{ ...b, deletedAt: t2, updatedAt: t2 }]);
    expect((await liveNotes(db)).map((x) => x.title)).toEqual(['A']);
  });
});

describe('backup includes tracked time and notes', () => {
  it('round-trips both', async () => {
    await pushEntries(db, [entry({ endedAt: new Date().toISOString() })]);
    await pushNotes(db, [note({ title: 'Keep me' })]);
    const backup = JSON.parse(JSON.stringify(await exportAll(db)));
    expect(backup.entries).toHaveLength(1);
    expect(backup.notes).toHaveLength(1);
    const other = await openDb('pglite:memory', { migrate: true });
    try {
      const res = await importBackup(other.db, backup);
      expect(res).toMatchObject({ entries: 1, notes: 1, skipped: 0 });
      const st = await getState(other.db);
      expect(st.entries).toHaveLength(1);
      expect(st.notes.map((x) => x.title)).toEqual(['Keep me']);
    } finally {
      await other.close();
    }
  });
});

describe('planner context', () => {
  it('includes time tracked per project, the running timer and recent notes', () => {
    const now = new Date();
    const ago = (min: number) => new Date(now.getTime() - min * 60e3).toISOString();
    const settings = { ...DEFAULT_SETTINGS, p1: { name: 'Finapt', notes: '' }, p2: { name: 'bazaar', notes: '' } };
    const text = contextBlock([], settings, now, {
      entries: [
        entry({ project: 'p1', startedAt: ago(200), endedAt: ago(80) }),
        entry({ project: 'p2', label: 'Bazaar doc', startedAt: ago(30), endedAt: null }),
      ],
      notes: [note({ title: 'Launch ideas', body: 'pricing page needs work' })],
    });
    expect(text).toContain('Time tracked in the last 7 days: 2h 30m — Finapt 2h 00m, bazaar 30m');
    expect(text).toMatch(/Timer running now: "Bazaar doc" \(bazaar\) since \d\d:\d\d/);
    expect(text).toContain('- Launch ideas: pricing page needs work');
  });
});
