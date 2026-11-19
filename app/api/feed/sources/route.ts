import { z } from 'zod';
import { FeedError, feedTitleFallback, loadFeed, normalizeFeedUrl } from '@/lib/server/feeds';
import { handle, json, requireSession } from '@/lib/server/http';
import { addFeedSource, removeFeedSource } from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

const AddIn = z.object({ input: z.string().trim().min(1).max(500) });

/** POST { input: "lenny" | "name.substack.com" | "https://custom.domain" } → subscribe (checks the feed first). */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  const body = AddIn.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'Type a Substack name or address.' }, 400);
  try {
    const url = normalizeFeedUrl(body.data.input);
    const feed = await loadFeed(url, true);
    if (!feed.items.length) return json({ error: 'That feed has no posts yet.' }, 400);
    const source = await addFeedSource(a.db, { url, title: feed.title || feedTitleFallback(url), site: feed.site, image: feed.image });
    return json({ source });
  } catch (e) {
    if (e instanceof FeedError) return json({ error: e.message }, 400);
    if (e instanceof Error && /fetch failed|aborted|timeout/i.test(e.message)) return json({ error: 'Couldn’t reach that address. Is it a Substack?' }, 400);
    throw e;
  }
});

/** DELETE ?id= → unsubscribe. */
export const DELETE = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  const id = new URL(req.url).searchParams.get('id');
  if (!id || id.length > 64) return json({ error: 'bad request' }, 400);
  await removeFeedSource(a.db, id);
  return json({ ok: true });
});
