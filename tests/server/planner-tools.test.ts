import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type DB } from '@/lib/server/db/connect';
import { runTool } from '@/lib/server/plannerTools';
import { getSettings, liveAlarms, liveEntries, liveItems, liveNotes, pushItems } from '@/lib/server/repo';
import { parseAlarm, ringing, zonedToUtc } from '@/lib/shared/alarm';
import { makeItem } from '../helpers/fixtures';

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openDb('pglite:memory', { migrate: true }));
});
afterAll(() => close());

// Wed 18 Nov 2026, 10:00 in Dubai (06:00Z)
const NOW = new Date('2026-11-18T06:00:00Z');
const ctx = () => ({ db, tz: 'Asia/Dubai', now: NOW });

describe('alarm parsing and time zones', () => {
  it('turns wall-clock time in a zone into the right instant', () => {
    expect(zonedToUtc('2026-11-18', '16:00', 'Asia/Dubai').toISOString()).toBe('2026-11-18T12:00:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  it('parses “4pm”, “25 min”, “tomorrow 9am gym”', () => {
    const now = new Date(2026, 10, 18, 10, 0);
    expect(parseAlarm('timer till 4pm', now)?.at).toEqual(new Date(2026, 10, 18, 16, 0));
    expect(parseAlarm('25 min', now)?.at).toEqual(new Date(now.getTime() + 25 * 60e3));
    expect(parseAlarm('in 1h 30m tea', now)).toEqual({ label: 'tea', at: new Date(now.getTime() + 90 * 60e3) });
    expect(parseAlarm('tomorrow 9am gym', now)).toEqual({ label: 'gym', at: new Date(2026, 10, 19, 9, 0) });
    expect(parseAlarm('8am', now)?.at).toEqual(new Date(2026, 10, 19, 8, 0)); // already passed → tomorrow
    expect(parseAlarm('hello', now)).toBeNull();
  });

  it('rings when due, not after an hour', () => {
    const a = (at: string) => ({ id: at, label: '', at, dismissedAt: null, createdAt: at, updatedAt: at, deletedAt: null });
    const now = Date.parse('2026-11-18T12:00:30Z');
    expect(ringing([a('2026-11-18T12:00:00Z'), a('2026-11-18T10:00:00Z'), a('2026-11-18T13:00:00Z')], now).map((x) => x.at)).toEqual(['2026-11-18T12:00:00Z']);
  });
});

describe('planner tools act on every app', () => {
  it('set_alarm: “timer till 4pm” rings at 16:00 Dubai; in_minutes works too', async () => {
    const o = await runTool('set_alarm', { time: '16:00', label: 'Leave' }, ctx());
    expect(o.isError).toBeFalsy();
    expect(o.did).toEqual(['Alarm set for 16:00 — Leave']);
    const o2 = await runTool('set_alarm', { in_minutes: 25 }, ctx());
    expect(o2.did?.[0]).toMatch(/^Timer set for 25m \(rings at 10:25\)$/);
    const al = await liveAlarms(db);
    expect(al.map((x) => x.at).sort()).toEqual(['2026-11-18T06:25:00.000Z', '2026-11-18T12:00:00.000Z']);
    const c = await runTool('cancel_alarms', { ids: [al[0].id] }, ctx());
    expect(c.did).toEqual(['Cancelled 1 alarm']);
  });

  it('update_items / delete_items change existing things by id', async () => {
    const it0 = makeItem({ title: 'Send invoice', date: '2026-11-18' });
    await pushItems(db, [it0]);
    const done = await runTool('update_items', { items: [{ id: it0.id, done: true }] }, ctx());
    expect(done.did).toEqual(['Marked “Send invoice” done']);
    const moved = await runTool('update_items', { items: [{ id: it0.id, date: '2026-11-20', title: 'Send invoice v2' }] }, ctx());
    expect(moved.did).toEqual(['Updated “Send invoice v2”']);
    expect((await liveItems(db)).find((x) => x.id === it0.id)).toMatchObject({ done: true, date: '2026-11-20', title: 'Send invoice v2' });
    const missing = await runTool('update_items', { items: [{ id: 'nope', done: true }] }, ctx());
    expect(missing.isError).toBe(true);
    const del = await runTool('delete_items', { ids: [it0.id] }, ctx());
    expect(del.did).toEqual(['Deleted “Send invoice v2”']);
    expect((await liveItems(db)).some((x) => x.id === it0.id)).toBe(false);
  });

  it('time tracker, notebook, settings and desk actions', async () => {
    expect((await runTool('start_timer', { label: 'Bazaar doc', project: 'p2' }, ctx())).did).toEqual(['Timer started: Bazaar doc']);
    expect((await liveEntries(db)).filter((e) => !e.endedAt)).toHaveLength(1);
    const stop = await runTool('stop_timer', {}, { ...ctx(), now: new Date(NOW.getTime() + 30 * 60e3) });
    expect(stop.did).toEqual(['Timer stopped (30m)']);

    const n = await runTool('add_note', { title: 'Ideas', body: 'one' }, ctx());
    const id = (n.result as { id: string }).id;
    await runTool('update_note', { id, append: 'two' }, ctx());
    expect((await liveNotes(db)).find((x) => x.id === id)?.body).toBe('one\ntwo');

    const st = await runTool('update_settings', { p1_name: 'Finapt', theme: 'light' }, ctx());
    expect(st.did).toEqual(['Renamed “project one” to “Finapt”', 'Switched to light theme']);
    expect((await getSettings(db)).p1.name).toBe('Finapt');

    const ui = await runTool('desk_action', { action: 'open', window: 'alarms' }, ctx());
    expect(ui.ui).toEqual([{ action: 'open', window: 'alarms' }]);
    expect((await runTool('desk_action', { action: 'open' }, ctx())).isError).toBe(true);
  });

  it('rejects bad input without writing anything', async () => {
    expect((await runTool('set_alarm', { time: '25:99' }, ctx())).isError).toBe(true);
    expect((await runTool('nope', {}, ctx())).isError).toBe(true);
  });
});
