import { handle, json, requireSession } from '@/lib/server/http';
import { getState } from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

/** Everything the desk shows: items, settings, chat, window layout. */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  return json(await getState(a.db));
});
