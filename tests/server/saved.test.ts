import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '@/lib/server/db/connect';
import { items, savedArticles } from '@/lib/server/db/schema';
import { exportAll, getSaved, importBackup, listSaved, saveArticle, unsaveArticle } from '@/lib/server/repo';
import type { FeedItem } from '@/lib/shared/types';

let db: DB;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await openDb('pglite:memory', { migrate: true }));
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(savedArticles);
  await db.delete(items);
});

const post = (id: string, title: string): FeedItem => ({
  id,
  feed: 'https://designnotes.substack.com/feed',
  sourceTitle: 'Design Notes',
  sourceImage: 'https://substackcdn.com/logo.png',
  title,
  subtitle: 'A subtitle',
  author: 'Sam',
  date: '2026-11-17T08:00:00.000Z',
  image: '',
  link: `https://designnotes.substack.com/p/${id}`,
});

describe('feed.app — Saved', () => {
  it('keeps a copy of the article, newest first, and lets it go again', async () => {
    await saveArticle(db, post('aaaaaaaaaaaaaaaa', 'First'), '<p>one</p>', new Date('2026-11-01T00:00:00Z'));
    const b = await saveArticle(db, post('bbbbbbbbbbbbbbbb', 'Second'), '<p>two</p>');
    expect(b).toMatchObject({ id: 'bbbbbbbbbbbbbbbb', title: 'Second', html: '<p>two</p>' });

    const list = await listSaved(db);
    expect(list.map((x) => x.title)).toEqual(['Second', 'First']);
    expect(list[0].html).toBeUndefined();
    expect((await getSaved(db, 'aaaaaaaaaaaaaaaa'))?.html).toBe('<p>one</p>');

    // Saving again moves it to the top.
    await saveArticle(db, post('aaaaaaaaaaaaaaaa', 'First'), '<p>one</p>');
    expect((await listSaved(db)).map((x) => x.title)).toEqual(['First', 'Second']);

    await unsaveArticle(db, 'aaaaaaaaaaaaaaaa');
    expect((await listSaved(db)).map((x) => x.title)).toEqual(['Second']);
    expect(await getSaved(db, 'aaaaaaaaaaaaaaaa')).toBeNull();
  });

  it('goes into backups and comes back, with the HTML cleaned again on import', async () => {
    await saveArticle(db, post('cccccccccccccccc', 'Kept'), '<p>kept</p>');
    const backup = await exportAll(db);
    expect(backup.saved).toHaveLength(1);
    expect(backup.saved![0].html).toBe('<p>kept</p>');

    await db.delete(savedArticles);
    backup.saved![0].html = '<p>kept</p><script>alert(1)</script><img src="https://x/y.png" onerror="alert(2)">';
    backup.saved!.push({ ...backup.saved![0], id: 'not-an-id' }, { ...backup.saved![0], id: 'dddddddddddddddd', feed: 'http://169.254.169.254/feed' });
    await importBackup(db, backup);

    const back = await listSaved(db);
    expect(back.map((x) => x.id)).toEqual(['cccccccccccccccc']);
    const html = (await getSaved(db, 'cccccccccccccccc'))!.html!;
    expect(html).toContain('<p>kept</p>');
    expect(html).not.toMatch(/<script|onerror/i);
  });
});
