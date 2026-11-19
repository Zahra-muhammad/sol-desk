import 'server-only';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { XMLParser } from 'fast-xml-parser';
import sanitizeHtml from 'sanitize-html';
import type { FeedItem, FeedSource } from '@/lib/shared/types';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 4_000_000;
const CACHE_MS = 10 * 60e3;

export class FeedError extends Error {}

/**
 * "lenny" → https://lenny.substack.com/feed
 * "lenny.substack.com" / a post URL → https://lenny.substack.com/feed
 * "www.lennysnewsletter.com" (custom domain) → https://www.lennysnewsletter.com/feed
 */
export function normalizeFeedUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new FeedError('Type a Substack name or address.');
  if (/^@?[a-z0-9-]{1,63}$/i.test(s)) return `https://${s.replace(/^@/, '').toLowerCase()}.substack.com/feed`;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new FeedError('That doesn’t look like a web address.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FeedError('Use an https:// address.');
  const host = u.hostname.toLowerCase();
  if (!host.includes('.')) throw new FeedError('That doesn’t look like a web address.');
  // A feed URL stays as-is; anything else on the site (home page, a post) maps to /feed.
  const path = /\/feed\/?$/.test(u.pathname) ? u.pathname.replace(/\/$/, '') : '/feed';
  return `https://${host}${u.port && u.port !== '443' ? ':' + u.port : ''}${path}`;
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
async function safeFetch(start: string): Promise<string> {
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5', 'user-agent': 'sol-desk feed reader' },
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

export interface ParsedFeed {
  title: string;
  site: string;
  image: string;
  items: (Omit<FeedItem, 'sourceId' | 'sourceTitle' | 'sourceImage'> & { html: string })[];
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
  if (!ch) throw new FeedError('That address didn’t return a feed. Is it a Substack?');
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
      };
    })
    .filter((x) => x.link);
  const img = ch.image as { url?: unknown } | undefined;
  return { title: plain(txt(ch.title), 200), site: txt(ch.link), image: /^https:\/\//.test(txt(img?.url)) ? txt(img?.url) : '', items };
}

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

// ---------------------------------------------------------------- cache

const cache = new Map<string, { at: number; feed: ParsedFeed }>();

/** Fetch + parse a feed, with a 10-minute cache per server instance. */
export async function loadFeed(url: string, fresh = false): Promise<ParsedFeed> {
  const hit = cache.get(url);
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit.feed;
  const feed = parseFeed(await safeFetch(url));
  cache.set(url, { at: Date.now(), feed });
  return feed;
}

export const feedTitleFallback = (url: string) => new URL(url).hostname.replace(/\.substack\.com$/, '');

export type { FeedItem, FeedSource };
