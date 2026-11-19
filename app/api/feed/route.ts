import { FeedError, loadFeed } from '@/lib/server/feeds';
import { handle, json, requireSession } from '@/lib/server/http';
import { listFeedSources } from '@/lib/server/repo';
import type { FeedItem, FeedSource } from '@/lib/shared/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/feed[?fresh=1] → every subscribed Substack's latest posts, newest first. */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req);
  if (a instanceof Response) return a;
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  const sources = await listFeedSources(a.db);
  const results = await Promise.allSettled(sources.map((s) => loadFeed(s.url, fresh)));
  const items: FeedItem[] = [];
  const out: FeedSource[] = sources.map((s, i) => {
    const r = results[i];
    if (r.status === 'rejected') return { ...s, error: r.reason instanceof FeedError ? r.reason.message : 'Couldn’t load this feed right now.' };
    for (const it of r.value.items) {
      const { html: _html, ...rest } = it;
      void _html;
      items.push({ ...rest, sourceId: s.id, sourceTitle: s.title || r.value.title, sourceImage: s.image || r.value.image });
    }
    return s;
  });
  items.sort((x, y) => y.date.localeCompare(x.date));
  return json({ sources: out, items: items.slice(0, 400) });
});
