import { describe, expect, it } from 'vitest';
import { TOPICS, articleDocument, articleFileName, isTopic, thumbUrl } from '@/lib/shared/feed';

describe('feed.app — downloads', () => {
  it('names the file after the title', () => {
    expect(articleFileName('Grids, again: why 8pt still matters!')).toBe('grids-again-why-8pt-still-matters.html');
    expect(articleFileName('Café crème')).toBe('cafe-creme.html');
    expect(articleFileName('???')).toBe('article.html');
    expect(articleFileName('x'.repeat(200)).length).toBeLessThanOrEqual(85);
  });

  it('builds a self-contained page with the title and byline escaped', () => {
    const doc = articleDocument({
      title: 'Tags <script>alert(1)</script> & things',
      subtitle: 'A "quoted" subtitle',
      author: 'Sam',
      sourceTitle: 'Design Notes',
      date: '2026-11-17T08:00:00.000Z',
      link: 'https://designnotes.substack.com/p/x',
      html: '<p>Body</p>',
    });
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toContain('<title>Tags &lt;script&gt;alert(1)&lt;/script&gt; &amp; things</title>');
    expect(doc).not.toContain('<script>');
    expect(doc).toContain('A &quot;quoted&quot; subtitle');
    expect(doc).toContain('Design Notes · Sam · 17 November 2026');
    expect(doc).toContain('<p>Body</p>');
    expect(doc).toContain('href="https://designnotes.substack.com/p/x"');
  });

  it('shrinks Substack’s raw uploads into small thumbnails and leaves other images alone', () => {
    const raw = 'https://substack-post-media.s3.amazonaws.com/public/images/abc_4320x2430.png';
    expect(thumbUrl(raw, 160)).toBe(`https://substackcdn.com/image/fetch/w_160,h_160,c_fill,f_auto,q_auto:good,fl_progressive:steep/${encodeURIComponent(raw)}`);
    expect(thumbUrl('https://substackcdn.com/image/fetch/w_1456/x.png', 160)).toBe('https://substackcdn.com/image/fetch/w_1456/x.png');
    expect(thumbUrl('https://example.com/a.jpg', 160)).toBe('https://example.com/a.jpg');
  });

  it('knows its topics', () => {
    expect(TOPICS.length).toBeGreaterThan(10);
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    expect(isTopic(96)).toBe(true);
    expect(isTopic(0)).toBe(false);
    expect(isTopic(NaN)).toBe(false);
  });
});
