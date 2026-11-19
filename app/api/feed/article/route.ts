import { FeedError, feedUrl, findPost } from '@/lib/server/feeds';
import { handle, json, requireSession } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET ?feed=https://name.substack.com/feed&id=<post id> → that post's body as cleaned HTML.
 * Only plain https://host/feed addresses on the public internet are fetched, and only Substack feeds are read.
 */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req);
  if (a instanceof Response) return a;
  const q = new URL(req.url).searchParams;
  const feed = feedUrl(q.get('feed') ?? '');
  const id = q.get('id') ?? '';
  if (!feed || !/^[0-9a-f]{16}$/.test(id)) return json({ error: 'bad request' }, 400);
  try {
    const post = await findPost(feed, id);
    if (!post) return json({ error: 'That post isn’t on Substack any more.' }, 404);
    return json({ id, html: post.html });
  } catch (e) {
    if (e instanceof FeedError) return json({ error: e.message }, 400);
    if (e instanceof Error && /fetch failed|aborted|timeout/i.test(e.message)) return json({ error: 'Couldn’t reach Substack — check your connection.' }, 502);
    throw e;
  }
});
