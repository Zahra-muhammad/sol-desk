import { describe, expect, it } from 'vitest';
import { TOPICS, articleDocument, articleFileName, isTopic } from '@/lib/shared/feed';

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

  it('knows its topics', () => {
    expect(TOPICS.length).toBeGreaterThan(10);
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    expect(isTopic(96)).toBe(true);
    expect(isTopic(0)).toBe(false);
    expect(isTopic(NaN)).toBe(false);
  });
});
