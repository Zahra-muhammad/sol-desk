import 'server-only';
import { and, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { zonedToUtc } from '@/lib/shared/alarm';
import { EMPTY_DAY, type DayActivity, type YearActivity } from '@/lib/shared/activity';
import type { DB } from './db/client';
import { alarms, chatMessages, items, loginAttempts, notes, timeEntries } from './db/schema';

/**
 * Per-day activity for one calendar year, with days counted in Sol's time zone.
 * Everything comes from the data the desk already keeps — nothing extra is tracked.
 */
export async function activityYear(db: DB, year: number, tz: string): Promise<YearActivity> {
  const from = zonedToUtc(`${year}-01-01`, '00:00', tz);
  const to = zonedToUtc(`${year + 1}-01-01`, '00:00', tz);
  const day = (col: AnyPgColumn) => sql<string>`to_char((${col} at time zone ${tz})::date, 'YYYY-MM-DD')`;
  const inYear = (col: AnyPgColumn) => and(gte(col, from), lt(col, to));
  const out: YearActivity = {};
  const add = (rows: { d: string; n: number | string | null }[], field: keyof DayActivity) => {
    for (const r of rows) {
      out[r.d] ??= { ...EMPTY_DAY };
      out[r.d][field] += Math.round(Number(r.n) || 0);
    }
  };
  const countBy = async (table: PgTable, col: AnyPgColumn, where?: SQL) =>
    db
      .select({ d: day(col), n: sql<string>`count(*)` })
      .from(table)
      .where(where ? and(inYear(col), where) : inYear(col))
      .groupBy(sql`1`);

  add(await countBy(loginAttempts, loginAttempts.at, eq(loginAttempts.ok, true)), 'logins');
  add(await countBy(items, items.createdAt), 'added');
  add(await countBy(items, items.doneAt, and(isNotNull(items.doneAt), eq(items.done, true))), 'done');
  add(await countBy(notes, notes.updatedAt), 'notes');
  add(await countBy(alarms, alarms.createdAt), 'alarms');
  add(await countBy(chatMessages, chatMessages.createdAt, eq(chatMessages.role, 'user')), 'chats');
  add(
    await db
      .select({
        d: day(timeEntries.startedAt),
        n: sql<string>`sum(extract(epoch from (coalesce(${timeEntries.endedAt}, now()) - ${timeEntries.startedAt})) / 60)`,
      })
      .from(timeEntries)
      .where(and(inYear(timeEntries.startedAt), sql`${timeEntries.deletedAt} is null`))
      .groupBy(sql`1`),
    'minutes',
  );
  return out;
}
