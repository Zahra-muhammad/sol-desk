import { handle, json, requireSession } from '@/lib/server/http';
import { getDelta, getSettings, patchSettings, pushEntries, pushItems, pushNotes, putLayout } from '@/lib/server/repo';
import { PushIn } from '@/lib/server/validate';

export const dynamic = 'force-dynamic';

/** Pull: what changed since `?since=` (other devices, the planner). Not counted as activity. */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req);
  if (a instanceof Response) return a;
  const raw = new URL(req.url).searchParams.get('since');
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : new Date(0);
  return json(await getDelta(a.db, since));
});

/** Push: saves items, tracked time and notes (newest edit wins), settings and window layout. */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  if (Number(req.headers.get('content-length') || 0) > 5_000_000) return json({ error: 'too large' }, 413);
  const body = PushIn.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'bad request', issues: body.error.issues.slice(0, 5) }, 400);
  const { items = [], entries = [], notes = [], settings, layout } = body.data;
  const saved = await pushItems(a.db, items);
  const savedEntries = await pushEntries(a.db, entries);
  const savedNotes = await pushNotes(a.db, notes);
  const st = settings ? await patchSettings(a.db, settings) : await getSettings(a.db);
  if (layout?.length) await putLayout(a.db, layout);
  return json({ items: saved, entries: savedEntries, notes: savedNotes, settings: st });
});
