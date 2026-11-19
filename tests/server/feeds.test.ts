import { describe, expect, it } from 'vitest';
import { FeedError, SEED_HOSTS, directoryFeeds, feedUrl, isPublicAddress, isSubstack, parseFeed, pickPosts, sanitizeArticle } from '@/lib/server/feeds';

const LONG = '<p>' + 'A real paragraph of writing. '.repeat(80) + '</p>';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
  <channel>
    <title><![CDATA[Design Notes]]></title>
    <link>https://designnotes.substack.com</link>
    <image><url>https://substackcdn.com/image/logo.png</url></image>
    <generator>Substack</generator>
    <item>
      <title><![CDATA[Grids, again]]></title>
      <description><![CDATA[Why the 8pt grid still matters]]></description>
      <link>https://designnotes.substack.com/p/grids-again</link>
      <dc:creator><![CDATA[Sam]]></dc:creator>
      <pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate>
      <enclosure url="https://substackcdn.com/image/cover.jpg" length="0" type="image/jpeg"/>
      <content:encoded><![CDATA[<p>Hello <b>grid</b></p><script>alert(1)</script><img src="https://x/y.png" onerror="alert(2)"><a href="javascript:alert(3)">x</a>${LONG}]]></content:encoded>
    </item>
    <item>
      <title>Second</title>
      <link>https://designnotes.substack.com/p/second</link>
      <pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>A short note.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

describe('feed.app — where posts come from', () => {
  it('accepts only plain https://host/feed addresses', () => {
    expect(feedUrl('https://Lenny.Substack.com/feed')).toBe('https://lenny.substack.com/feed');
    expect(feedUrl('https://www.lennysnewsletter.com/feed')).toBe('https://www.lennysnewsletter.com/feed');
    for (const bad of ['http://x.substack.com/feed', 'https://x.substack.com/feed/', 'https://x.substack.com/feed?a=1', 'https://x.substack.com:444/feed', 'https://u:p@x.substack.com/feed', 'https://127.0.0.1/feed', 'https://localhost/feed', 'https://x.substack.com/p/post', 'nonsense', '']) {
      expect(feedUrl(bad), bad).toBeNull();
    }
  });

  it('reads Substack’s directory: English publications only, custom domains preferred, spam skipped', () => {
    const feeds = directoryFeeds({
      publications: [
        { subdomain: 'designnotes', language: 'en' },
        { subdomain: 'lenny', custom_domain: 'www.lennysnewsletter.com', language: 'en-US' },
        { subdomain: 'portugues', language: 'pt-br' },
        { subdomain: 'spammy', language: 'en', flagged_as_spam: true },
        { subdomain: 'bad host!', language: 'en' },
        { subdomain: 'nolang' },
      ],
    });
    expect(feeds).toEqual(['https://designnotes.substack.com/feed', 'https://www.lennysnewsletter.com/feed', 'https://nolang.substack.com/feed']);
    expect(directoryFeeds(null)).toEqual([]);
    expect(directoryFeeds({ errors: [] })).toEqual([]);
  });

  it('has a fallback list of real feed addresses', () => {
    expect(SEED_HOSTS.length).toBeGreaterThan(30);
    for (const h of SEED_HOSTS) expect(feedUrl(`https://${h}/feed`), h).not.toBeNull();
  });

  it('never fetches private or local addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['104.18.1.1', '151.101.1.1', '2606:4700::1']) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe('feed.app — reading posts', () => {
  it('parses Substack RSS', () => {
    const f = parseFeed(RSS);
    expect(f).toMatchObject({ title: 'Design Notes', site: 'https://designnotes.substack.com', image: 'https://substackcdn.com/image/logo.png', generator: 'Substack' });
    expect(isSubstack(f)).toBe(true);
    expect(f.items).toHaveLength(2);
    expect(f.items[0]).toMatchObject({
      title: 'Grids, again',
      subtitle: 'Why the 8pt grid still matters',
      author: 'Sam',
      date: '2026-11-17T08:00:00.000Z',
      image: 'https://substackcdn.com/image/cover.jpg',
      link: 'https://designnotes.substack.com/p/grids-again',
    });
    expect(f.items[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(f.items[0].chars).toBeGreaterThan(1500);
    expect(() => parseFeed('<html>not a feed</html>')).toThrow(FeedError);
    expect(isSubstack(parseFeed(RSS.replace('<generator>Substack</generator>', '<generator>WordPress</generator>')))).toBe(false);
  });

  it('picks real articles over short notes', () => {
    const f = parseFeed(RSS);
    for (let i = 0; i < 10; i++) expect(pickPosts(f, 2).map((p) => p.title)).toEqual(['Grids, again']);
    const notesOnly = { ...f, items: f.items.filter((p) => p.title === 'Second') };
    expect(pickPosts(notesOnly, 2).map((p) => p.title)).toEqual(['Second']);
  });

  it('cleans article HTML: no scripts, handlers or javascript: links', () => {
    const html = sanitizeArticle(parseFeed(RSS).items[0].html);
    expect(html).toContain('<b>grid</b>');
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
    expect(html).toMatch(/<img[^>]+loading="lazy"/);
    expect(sanitizeArticle('<a href="https://x.com" onclick="y()">x</a>')).toBe('<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>');
  });
});
