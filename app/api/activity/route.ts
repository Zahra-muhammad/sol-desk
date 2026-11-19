import { activityYear } from '@/lib/server/activity';
import { handle, json, requireSession } from '@/lib/server/http';
import { TIME_ZONE } from '@/lib/server/planner';
import { validTimeZone } from '@/lib/shared/alarm';

export const dynamic = 'force-dynamic';

/** GET /api/activity?year=2026&tz=Asia/Dubai → { year, days: { 'YYYY-MM-DD': counts } } for the activity graph. */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req);
  if (a instanceof Response) return a;
  const q = new URL(req.url).searchParams;
  const year = Number(q.get('year'));
  const tz = q.get('tz');
  const y = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();
  return json({ year: y, days: await activityYear(a.db, y, validTimeZone(tz) ? tz : TIME_ZONE) });
});
