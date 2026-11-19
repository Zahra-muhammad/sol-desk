import { describe, expect, it } from 'vitest';
import { FeedError, isPublicAddress, normalizeFeedUrl, parseFeed, sanitizeArticle } from '@/lib/server/feeds';

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
      <content:encoded><![CDATA[<p>Hello <b>grid</b></p><script>alert(1)</script><img src="https://x/y.png" onerror="alert(2)"><a href="javascript:alert(3)">x</a>]]></content:encoded>
    </item>
    <item>
      <title>Second</title>
      <link>https://designnotes.substack.com/p/second</link>
      <pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe('feed.app — finding a Substack feed', () => {
  it('turns names, addresses and post links into a feed URL', () => {
    expect(normalizeFeedUrl('lenny')).toBe('https://lenny.substack.com/feed');
    expect(normalizeFeedUrl('@Lenny')).toBe('https://lenny.substack.com/feed');
    expect(normalizeFeedUrl('lenny.substack.com')).toBe('https://lenny.substack.com/feed');
    expect(normalizeFeedUrl('https://lenny.substack.com/p/some-post?utm=x')).toBe('https://lenny.substack.com/feed');
    expect(normalizeFeedUrl('www.lennysnewsletter.com')).toBe('https://www.lennysnewsletter.com/feed');
    expect(normalizeFeedUrl('https://example.com/feed/')).toBe('https://example.com/feed');
    expect(() => normalizeFeedUrl('   ')).toThrow(FeedError);
    expect(() => normalizeFeedUrl('ftp://x.com')).toThrow(FeedError);
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
    expect(f).toMatchObject({ title: 'Design Notes', site: 'https://designnotes.substack.com', image: 'https://substackcdn.com/image/logo.png' });
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
    expect(() => parseFeed('<html>not a feed</html>')).toThrow(FeedError);
  });

  it('cleans article HTML: no scripts, handlers or javascript: links', () => {
    const html = sanitizeArticle(parseFeed(RSS).items[0].html);
    expect(html).toContain('<b>grid</b>');
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
    expect(html).toMatch(/<img[^>]+loading="lazy"/);
    expect(sanitizeArticle('<a href="https://x.com" onclick="y()">x</a>')).toBe('<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>');
  });
});
