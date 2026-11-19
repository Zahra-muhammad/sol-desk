import { describe, expect, it } from 'vitest';
import { EMPTY_DAY, level, score, yearStats, yearWeeks } from '@/lib/shared/activity';

const day = (p: Partial<typeof EMPTY_DAY>) => ({ ...EMPTY_DAY, ...p });

describe('activity graph maths', () => {
  it('scores a day: one per action, one per 30 minutes tracked', () => {
    expect(score(day({ logins: 2, done: 3, minutes: 95 }))).toBe(2 + 3 + 3);
    expect(score(undefined)).toBe(0);
  });

  it('levels are relative to the busiest day', () => {
    expect([0, 1, 3, 6, 10].map((s) => level(s, 10))).toEqual([0, 1, 2, 3, 4]);
  });

  it('lays the year out in Monday-first weeks', () => {
    const w = yearWeeks(2026); // 1 Jan 2026 is a Thursday
    expect(w[0]).toEqual([null, null, null, '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    expect(w.flat().filter(Boolean)).toHaveLength(365);
    expect(w.at(-1)!.filter(Boolean).at(-1)).toBe('2026-12-31');
  });

  it('counts active days and streaks; today can still join the streak', () => {
    const days = {
      '2026-11-10': day({ logins: 1 }),
      '2026-11-11': day({ done: 2 }),
      '2026-11-12': day({ notes: 1 }),
      '2026-11-17': day({ logins: 1 }),
      '2026-11-18': day({ added: 1, minutes: 60 }),
    };
    const s = yearStats(2026, days, '2026-11-19');
    expect(s.activeDays).toBe(5);
    expect(s.longestStreak).toBe(3);
    expect(s.currentStreak).toBe(2); // 17th + 18th; the 19th (today) hasn't happened yet
    expect(s.minutes).toBe(60);
    expect(s.total).toBe(1 + 2 + 1 + 1 + 1 + 2);
    expect(yearStats(2025, days, '2026-11-19').currentStreak).toBe(0);
  });
});
