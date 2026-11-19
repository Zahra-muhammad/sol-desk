// The activity graph (like GitHub's contributions): what happened each day, levels, streaks, totals.

export interface DayActivity {
  /** Successful unlocks (logins). */
  logins: number;
  /** To-dos, events and meetings added. */
  added: number;
  /** To-dos ticked off. */
  done: number;
  /** Notes written or edited. */
  notes: number;
  /** Minutes tracked with the timer. */
  minutes: number;
  /** Alarms set. */
  alarms: number;
  /** Messages sent to the planner. */
  chats: number;
}

export type YearActivity = Record<string, DayActivity>;

export const EMPTY_DAY: DayActivity = { logins: 0, added: 0, done: 0, notes: 0, minutes: 0, alarms: 0, chats: 0 };

/** One number per day: every action counts 1, and every 30 minutes tracked counts 1. */
export const score = (d: DayActivity | undefined) =>
  d ? d.logins + d.added + d.done + d.notes + d.alarms + d.chats + Math.floor(d.minutes / 30) : 0;

/** 0 = nothing, 1–4 = darker greens, scaled to the busiest day (like GitHub's quartiles). */
export function level(s: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (s <= 0 || max <= 0) return 0;
  const r = s / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Every day of the year as YYYY-MM-DD, grouped into Monday-first week columns (padded with nulls). */
export function yearWeeks(year: number): (string | null)[][] {
  const first = new Date(year, 0, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // back to Monday
  const weeks: (string | null)[][] = [];
  for (const d = new Date(start); d.getFullYear() <= year; ) {
    const week: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(d.getFullYear() === year ? ymd(d) : null);
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
    if (d.getFullYear() > year) break;
  }
  return weeks;
}

export interface YearStats {
  total: number;
  activeDays: number;
  longestStreak: number;
  /** Days in a row up to today (or up to yesterday, if today has nothing yet). */
  currentStreak: number;
  logins: number;
  added: number;
  done: number;
  notes: number;
  minutes: number;
  alarms: number;
  chats: number;
  max: number;
}

export function yearStats(year: number, days: YearActivity, today = ymd(new Date())): YearStats {
  const s: YearStats = { total: 0, activeDays: 0, longestStreak: 0, currentStreak: 0, logins: 0, added: 0, done: 0, notes: 0, minutes: 0, alarms: 0, chats: 0, max: 0 };
  let run = 0;
  const d = new Date(year, 0, 1);
  const end = today.startsWith(String(year)) ? today : `${year}-12-31`;
  for (; ymd(d) <= end; d.setDate(d.getDate() + 1)) {
    const k = ymd(d);
    const a = days[k];
    const sc = score(a);
    if (a) for (const f of ['logins', 'added', 'done', 'notes', 'minutes', 'alarms', 'chats'] as const) s[f] += a[f];
    s.total += sc;
    s.max = Math.max(s.max, sc);
    if (sc > 0) {
      s.activeDays++;
      run++;
      s.longestStreak = Math.max(s.longestStreak, run);
    } else if (k !== today) run = 0; // today can still become active
  }
  s.currentStreak = end === today ? run : 0;
  return s;
}
