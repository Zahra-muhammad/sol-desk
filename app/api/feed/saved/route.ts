import { z } from 'zod';
import { FeedError, feedUrl, findPost } from '@/lib/server/feeds';
import { handle, json, requireSession } from '@/lib/server/http';
import { getSaved, listSaved, saveArticle, unsaveArticle } from '@/lib/server/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ID = /^[0-9a-f]{16}$/;
const SaveIn = z.object({ feed: z.string().max(400), id: z.string().regex(ID) });

/** GET → saved articles (newest first, without HTML). GET ?id= → one saved article with its HTML. */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req);
  if (a instanceof Response) return a;
  const id = new URL(req.url).searchParams.get('id');
  if (id === null) return json({ saved: await listSaved(a.db) });
  if (!ID.test(id)) return json({ error: 'bad request' }, 400);
  const art = await getSaved(a.db, id);
  return art ? json({ article: art }) : json({ error: 'That article isn’t saved.' }, 404);
});

/** POST { feed, id } → fetch the post from its Substack feed, clean it, and keep a copy. */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  const body = SaveIn.safeParse(await req.json().catch(() => null));
  const feed = body.success ? feedUrl(body.data.feed) : null;
  if (!body.success || !feed) return json({ error: 'bad request' }, 400);
  try {
    const post = await findPost(feed, body.data.id);
    if (!post) return json({ error: 'That post isn’t on Substack any more.' }, 404);
    const { html: _html, ...article } = await saveArticle(a.db, post.item, post.html);
    void _html;
    return json({ article });
  } catch (e) {
    if (e instanceof FeedError) return json({ error: e.message }, 400);
    if (e instanceof Error && /fetch failed|aborted|timeout/i.test(e.message)) return json({ error: 'Couldn’t reach Substack — check your connection.' }, 502);
    throw e;
  }
});

/** DELETE ?id= → remove from Saved. */
export const DELETE = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!ID.test(id)) return json({ error: 'bad request' }, 400);
  await unsaveArticle(a.db, id);
  return json({ ok: true });
});
