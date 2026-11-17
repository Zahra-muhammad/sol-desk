// Time tracking maths: durations, today / this week totals, formatting.
import { iso } from './dates';
import type { ProjectKey, TimeEntry } from './types';

/** Milliseconds tracked by an entry (a running one counts up to `now`). */
export const entryMs = (e: TimeEntry, now = Date.now()) =>
  Math.max(0, (e.endedAt ? Date.parse(e.endedAt) : now) - Date.parse(e.startedAt));

/** "1h 05m", "42m", "0m". */
export function fmtDur(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** "0:42:07" — the ticking clock. */
export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Monday 00:00 (local) of the week containing `d` — the calendar's weeks start on Monday too. */
export function weekStart(d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export const running = (entries: TimeEntry[]) =>
  entries.filter((e) => !e.endedAt && !e.deletedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

/** Entries that started on a local calendar day (YYYY-MM-DD), newest first. */
export const startedOn = (entries: TimeEntry[], day: string) =>
  entries.filter((e) => !e.deletedAt && iso(new Date(e.startedAt)) === day).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

export type ProjectTotals = Record<ProjectKey | 'none', number>;

/** Tracked time per project for entries starting at or after `from`. */
export function totals(entries: TimeEntry[], from: Date, now = Date.now()): { total: number; byProject: ProjectTotals } {
  const byProject: ProjectTotals = { p1: 0, p2: 0, none: 0 };
  let total = 0;
  for (const e of entries) {
    if (e.deletedAt || Date.parse(e.startedAt) < from.getTime()) continue;
    const ms = entryMs(e, now);
    byProject[e.project ?? 'none'] += ms;
    total += ms;
  }
  return { total, byProject };
}
