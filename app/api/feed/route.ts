import { discover } from '@/lib/server/feeds';
import { handle, json, requireSession } from '@/lib/server/http';
import { isTopic } from '@/lib/shared/feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/feed[?topic=<Substack category id>] → a fresh random handful of posts from across Substack. */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req);
  if (a instanceof Response) return a;
  const t = Number(new URL(req.url).searchParams.get('topic'));
  const items = await discover({ topic: isTopic(t) ? t : null });
  if (!items.length) return json({ error: 'Couldn’t reach Substack right now — try Shuffle again in a moment.' }, 502);
  return json({ items });
});
