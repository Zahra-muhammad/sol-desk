import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityYear } from '@/lib/server/activity';
import { openDb, type DB } from '@/lib/server/db/connect';
import { alarms, chatMessages, loginAttempts, notes, timeEntries } from '@/lib/server/db/schema';
import { pushItems } from '@/lib/server/repo';
import { makeItem } from '../helpers/fixtures';

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openDb('pglite:memory', { migrate: true }));
});
afterAll(() => close());

describe('activity per day (counted in Sol’s time zone)', () => {
  it('collects logins, plans, done to-dos, notes, alarms, chats and tracked time', async () => {
    // 22:30Z on the 17th is already the 18th in Dubai (UTC+4).
    await db.insert(loginAttempts).values([
      { ok: true, ip: null, at: new Date('2026-11-17T22:30:00Z') },
      { ok: true, ip: null, at: new Date('2026-11-18T09:00:00Z') },
      { ok: false, ip: null, at: new Date('2026-11-18T09:01:00Z') }, // failed: not counted
    ]);
    const t = '2026-11-18T06:00:00.000Z';
    await pushItems(db, [makeItem({ createdAt: t, updatedAt: t, done: true, doneAt: '2026-11-18T07:00:00.000Z' }), makeItem({ createdAt: t, updatedAt: t })]);
    await db.insert(notes).values({ id: 'n1', title: 'x', body: '', createdAt: new Date(t), updatedAt: new Date(t) });
    await db.insert(alarms).values({ id: 'a1', label: '', at: new Date('2026-11-18T12:00:00Z'), createdAt: new Date(t), updatedAt: new Date(t) });
    await db.insert(chatMessages).values([
      { role: 'user', content: 'plan my day', createdAt: new Date(t) },
      { role: 'assistant', content: 'ok', createdAt: new Date(t) },
    ]);
    await db.insert(timeEntries).values({
      id: 'e1',
      label: 'work',
      startedAt: new Date('2026-11-18T05:00:00Z'),
      endedAt: new Date('2026-11-18T06:30:00Z'),
      createdAt: new Date(t),
      updatedAt: new Date(t),
    });

    const days = await activityYear(db, 2026, 'Asia/Dubai');
    expect(days['2026-11-18']).toEqual({ logins: 2, added: 2, done: 1, notes: 1, minutes: 90, alarms: 1, chats: 1 });
    expect(days['2026-11-17']).toBeUndefined();
    expect(await activityYear(db, 2025, 'Asia/Dubai')).toEqual({});
  });
});
