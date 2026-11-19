import { loadFeed, sanitizeArticle } from '@/lib/server/feeds';
import { handle, json, requireSession } from '@/lib/server/http';
import { listFeedSources } from '@/lib/server/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET ?id=<post id> → the post's body as cleaned HTML. Only posts from subscribed feeds can be opened,
 * so this can't be used to fetch arbitrary pages.
 */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req);
  if (a instanceof Response) return a;
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !/^[0-9a-f]{16}$/.test(id)) return json({ error: 'bad request' }, 400);
  for (const s of await listFeedSources(a.db)) {
    const feed = await loadFeed(s.url).catch(() => null);
    const it = feed?.items.find((x) => x.id === id);
    if (it) return json({ id, html: sanitizeArticle(it.html) });
  }
  return json({ error: 'That post isn’t in your feed any more.' }, 404);
});
