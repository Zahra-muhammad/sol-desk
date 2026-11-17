import { describe, expect, it } from 'vitest';
import { entryMs, fmtClock, fmtDur, running, startedOn, totals, weekStart } from '@/lib/shared/time';
import type { TimeEntry } from '@/lib/shared/types';

const T0 = new Date(2026, 10, 17, 9, 0).getTime(); // Tue 17 Nov 2026, 09:00 local
const at = (min: number) => new Date(T0 + min * 60e3).toISOString();
const e = (p: Partial<TimeEntry>): TimeEntry => ({
  id: Math.random().toString(36).slice(2),
  label: 'x',
  project: null,
  startedAt: at(0),
  endedAt: at(30),
  createdAt: at(0),
  updatedAt: at(0),
  deletedAt: null,
  ...p,
});

describe('time tracking maths', () => {
  it('formats durations and the ticking clock', () => {
    expect(fmtDur(0)).toBe('0m');
    expect(fmtDur(42 * 60e3)).toBe('42m');
    expect(fmtDur(65 * 60e3)).toBe('1h 05m');
    expect(fmtClock((2 * 3600 + 3 * 60 + 9) * 1000)).toBe('2:03:09');
  });

  it('weeks start on Monday', () => {
    expect(weekStart(new Date(2026, 10, 17, 15)).getDate()).toBe(16); // Tue → Mon 16th
    expect(weekStart(new Date(2026, 10, 22, 15)).getDate()).toBe(16); // Sun → Mon 16th
    expect(weekStart(new Date(2026, 10, 16, 0, 1)).getDate()).toBe(16);
  });

  it('counts a running timer up to now, and totals by project', () => {
    const now = T0 + 90 * 60e3;
    const list = [
      e({ project: 'p1', startedAt: at(0), endedAt: at(45) }),
      e({ project: 'p2', startedAt: at(50), endedAt: at(60) }),
      e({ project: null, startedAt: at(60), endedAt: null }), // running for 30 min
      e({ project: 'p1', startedAt: at(0), endedAt: at(600), deletedAt: at(700) }), // deleted: ignored
      e({ project: 'p1', startedAt: at(-3 * 24 * 60), endedAt: at(-3 * 24 * 60 + 60) }), // last Saturday: before this week
    ];
    expect(entryMs(list[2], now)).toBe(30 * 60e3);
    const t = totals(list, weekStart(new Date(T0)), now);
    expect(t.byProject).toEqual({ p1: 45 * 60e3, p2: 10 * 60e3, none: 30 * 60e3 });
    expect(t.total).toBe(85 * 60e3);
    expect(running(list)?.endedAt).toBeNull();
    expect(startedOn(list, '2026-11-17')).toHaveLength(3);
  });
});
