import 'server-only';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { XMLParser } from 'fast-xml-parser';
import sanitizeHtml from 'sanitize-html';
import { TOPICS } from '@/lib/shared/feed';
import type { FeedItem } from '@/lib/shared/types';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 4_000_000;
const FEED_CACHE_MS = 10 * 60e3;
const FEED_CACHE_MAX = 50;
const DIR_CACHE_MS = 6 * 3600e3;
/** Substack's directory serves pages 0–20 of each category, 25 publications a page. */
const DIR_PAGES = 21;
/** How many publications one shuffle samples, and how long it waits for them. */
const SAMPLE = 10;
const SAMPLE_WAIT_MS = 9000;

export class FeedError extends Error {}

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Accepts only a plain https://host/feed address (no port, credentials or query) and returns it normalised. */
export function feedUrl(s: string): string | null {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
  if (u.pathname !== '/feed' || !HOST_RE.test(u.hostname)) return null;
  return `https://${u.hostname.toLowerCase()}/feed`;
}

/** Is this an address on the public internet (not this machine or a private network)? */
export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return false;
    if (x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80')) return false;
    if (x.startsWith('::ffff:')) return isPublicAddress(x.slice(7));
    return true;
  }
  return false;
}

/** Refuse to fetch anything that resolves to a private or local address. */
async function assertPublicHost(url: URL) {
  if (url.protocol !== 'https:') throw new FeedError('Only https:// feeds are supported.');
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new FeedError('That address isn’t allowed.');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new FeedError(`Couldn’t find ${host}.`);
  if (!addrs.every((a) => isPublicAddress(a.address))) throw new FeedError('That address isn’t allowed.');
}

/** GET with a timeout, a size cap, and the public-address check on every redirect hop. */
async function safeFetch(start: string, accept = 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5'): Promise<string> {
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; sol-desk feed reader)' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) throw new FeedError(`The feed answered ${res.status}.`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new FeedError('That feed is too large.');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new FeedError('That feed is too large.');
    return text;
  }
  throw new FeedError('Too many redirects.');
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', cdataPropName: false, processEntities: true });

const txt = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as { '#text': unknown })['#text'] ?? '');
  return '';
};
const plain = (html: string, max: number) =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const itemId = (link: string) => createHash('sha1').update(link).digest('hex').slice(0, 16);

export interface ParsedPost extends Omit<FeedItem, 'feed' | 'sourceTitle' | 'sourceImage'> {
  html: string;
  /** Rough length of the article text, to tell real articles from short notes and podcast stubs. */
  chars: number;
}

export interface ParsedFeed {
  title: string;
  site: string;
  image: string;
  generator: string;
  items: ParsedPost[];
}

/** Parse RSS 2.0 (what Substack serves). */
export function parseFeed(xml: string): ParsedFeed {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new FeedError('That address didn’t return a feed.');
  }
  const ch = (doc?.rss as { channel?: Record<string, unknown> } | undefined)?.channel;
  if (!ch) throw new FeedError('That address didn’t return a feed.');
  const raw = ch.item ? (Array.isArray(ch.item) ? ch.item : [ch.item]) : [];
  const items = (raw as Record<string, unknown>[])
    .map((it) => {
      const link = txt(it.link);
      const html = txt(it['content:encoded']) || txt(it.description);
      const enc = it.enclosure as { '@_url'?: string; '@_type'?: string } | undefined;
      const image = enc?.['@_url'] && (!enc['@_type'] || enc['@_type'].startsWith('image')) ? enc['@_url'] : (html.match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? '');
      const date = new Date(txt(it.pubDate));
      return {
        id: itemId(link),
        title: plain(txt(it.title), 300) || 'Untitled',
        subtitle: plain(txt(it.description), 280),
        author: plain(txt(it['dc:creator']), 120),
        date: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
        image: /^https:\/\//.test(image) ? image : '',
        link: /^https?:\/\//.test(link) ? link : '',
        html,
        chars: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').length,
      };
    })
    .filter((x) => x.link);
  const img = ch.image as { url?: unknown } | undefined;
  return {
    title: plain(txt(ch.title), 200),
    site: txt(ch.link),
    image: /^https:\/\//.test(txt(img?.url)) ? txt(img?.url) : '',
    generator: plain(txt(ch.generator), 100),
    items,
  };
}

export const isSubstack = (f: ParsedFeed) => /substack/i.test(f.generator);

/** Only safe markup reaches the browser: no scripts, styles, iframes, event handlers or javascript: links. */
export function sanitizeArticle(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'figure', 'figcaption', 'blockquote', 'ul', 'ol', 'li', 'em', 'i', 'strong', 'b', 'u', 's', 'code', 'pre', 'sup', 'sub', 'span', 'div', 'picture', 'source', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'], source: ['srcset', 'type', 'media'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https'], source: ['https'] },
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }),
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy', decoding: 'async' } }),
    },
  });
}

// ---------------------------------------------------------------- feeds (cached per server instance)

const feedCache = new Map<string, { at: number; feed: ParsedFeed }>();

/** Fetch + parse a feed, with a 10-minute cache that keeps the most recent 50 feeds. */
export async function loadFeed(url: string, fresh = false): Promise<ParsedFeed> {
  const hit = feedCache.get(url);
  if (hit && !fresh && Date.now() - hit.at < FEED_CACHE_MS) return hit.feed;
  const feed = parseFeed(await safeFetch(url));
  feedCache.delete(url);
  feedCache.set(url, { at: Date.now(), feed });
  while (feedCache.size > FEED_CACHE_MAX) feedCache.delete(feedCache.keys().next().value!);
  return feed;
}

export function toFeedItem(feed: string, f: ParsedFeed, p: ParsedPost): FeedItem {
  return { id: p.id, feed, sourceTitle: f.title, sourceImage: f.image, title: p.title, subtitle: p.subtitle, author: p.author, date: p.date, image: p.image, link: p.link };
}

/** One post from a Substack feed (looked up again if it isn't in the cached copy). */
export async function findPost(url: string, id: string): Promise<{ item: FeedItem; html: string } | null> {
  for (const fresh of [false, true]) {
    const f = await loadFeed(url, fresh);
    if (!isSubstack(f)) throw new FeedError('That isn’t a Substack.');
    const p = f.items.find((x) => x.id === id);
    if (p) return { item: toFeedItem(url, f, p), html: sanitizeArticle(p.html) };
  }
  return null;
}

// ---------------------------------------------------------------- discover: random posts from across Substack

/**
 * Popular English-language publications from Substack's directory (each checked for a working feed),
 * used when the directory itself can't be reached.
 */
export const SEED_HOSTS = [
  'www.californiacurrent.org', 'newyorker.substack.com', 'robwalker.substack.com', 'blog.bytebytego.com', 'newsletter.pragmaticengineer.com',
  'piratewires.substack.com', 'www.a16z.news', 'on.substack.com', 'www.lennysnewsletter.com', 'www.profgmedia.com',
  'yourlocalepidemiologist.substack.com', 'erictopol.substack.com', 'www.astralcodexten.com', 'www.theculturist.io', 'adamtooze.substack.com',
  'www.historicmysteries.net', 'morebetterthinking.substack.com', 'rickrubin.substack.com', 'thebookerprizes.substack.com', 'draculadaily.substack.com',
  'georgesaunders.substack.com', 'inagarten.substack.com', 'whattocook.substack.com', 'ottolenghi.substack.com', 'amandahesser.substack.com',
  'newsletter.uxdesign.cc', 'www.honest-broker.com', 'pattismith.substack.com', 'www.vulf.org', 'goodmovie.substack.com',
  'themakingof.substack.com', 'hunterharris.substack.com', 'filmmaker.substack.com', 'yolojournal.substack.com', 'elizabethminchilli.substack.com',
  'estherperel.substack.com', 'yungpueblo.substack.com', 'thepsychologyofyour20s.substack.com', 'www.compoundingquality.net', 'billmckibben.substack.com',
  'heated.world', 'www.volts.wtf', 'thebabylonbee.substack.com', 'christopherkimball.substack.com', 'designbetterpodcast.com',
];

/** Turn one page of Substack's directory into feed addresses: English, not flagged, with a usable host. */
export function directoryFeeds(json: unknown): string[] {
  const list = (json as { publications?: unknown } | null)?.publications;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const p of list as Record<string, unknown>[]) {
    if (!p || p.flagged_as_spam || p.invite_only) continue;
    if (!String(p.language || 'en').toLowerCase().startsWith('en')) continue;
    const custom = typeof p.custom_domain === 'string' && HOST_RE.test(p.custom_domain) ? p.custom_domain : '';
    const sub = typeof p.subdomain === 'string' && /^[a-z0-9-]{1,63}$/i.test(p.subdomain) ? `${p.subdomain}.substack.com` : '';
    const host = (custom || sub).toLowerCase();
    if (host) out.push(`https://${host}/feed`);
  }
  return out;
}

const dirCache = new Map<string, { at: number; feeds: string[] }>();

async function directoryPage(topic: number, page: number): Promise<string[]> {
  const key = `${topic}:${page}`;
  const hit = dirCache.get(key);
  if (hit && Date.now() - hit.at < DIR_CACHE_MS) return hit.feeds;
  const body = await safeFetch(`https://substack.com/api/v1/category/public/${topic}/all?page=${page}`, 'application/json');
  let feeds: string[] = [];
  try {
    feeds = directoryFeeds(JSON.parse(body));
  } catch {
    /* not JSON: treat as empty */
  }
  dirCache.set(key, { at: Date.now(), feeds });
  return feeds;
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rand = (n: number) => Math.floor(Math.random() * n);

/** Up to `n` random posts from a feed, preferring real articles over short notes and podcast stubs. */
export function pickPosts(feed: ParsedFeed, n: number): ParsedPost[] {
  const long = feed.items.filter((p) => p.chars >= 1500);
  return shuffle([...(long.length ? long : feed.items)]).slice(0, n);
}

/** Resolves to `undefined` instead of waiting past `ms`. */
const within = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);

/**
 * A fresh random handful of posts from across Substack: pick random categories (or the chosen one),
 * random directory pages, then random publications, then random articles from each.
 */
export async function discover(opts: { topic?: number | null; count?: number } = {}): Promise<FeedItem[]> {
  const count = opts.count ?? 18;
  const topics = opts.topic ? [opts.topic, opts.topic, opts.topic] : shuffle(TOPICS.map((t) => t.id)).slice(0, 4);
  const pages = await Promise.allSettled(topics.map((t) => within(directoryPage(t, rand(DIR_PAGES)), SAMPLE_WAIT_MS / 2)));
  let pool = [...new Set(pages.flatMap((p) => (p.status === 'fulfilled' && p.value) || []))];
  if (pool.length < SAMPLE) pool = [...new Set([...pool, ...shuffle(SEED_HOSTS.map((h) => `https://${h}/feed`))])];

  const picked = shuffle(pool).slice(0, SAMPLE);
  const loaded = await Promise.allSettled(picked.map((url) => within(loadFeed(url), SAMPLE_WAIT_MS)));
  const feeds = loaded.flatMap((r, i) => (r.status === 'fulfilled' && r.value && isSubstack(r.value) && r.value.items.length ? [{ url: picked[i], f: r.value }] : []));
  if (!feeds.length) return [];
  const per = Math.min(4, Math.max(2, Math.ceil(count / feeds.length)));
  const posts = feeds.flatMap(({ url, f }) => pickPosts(f, per).map((p) => toFeedItem(url, f, p)));
  return shuffle(posts).slice(0, count);
}
