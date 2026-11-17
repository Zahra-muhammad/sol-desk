// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteItem, loadState, saveItem, undoDelete } from '@/lib/client/actions';
import { idbOutbox } from '@/lib/client/idb';
import { S, initialDesk, setDesk } from '@/lib/client/store';
import { SaveStatusText } from '@/components/windows';
import { DEFAULT_SETTINGS } from '@/lib/shared/types';
import { makeItem } from '../helpers/fixtures';

const until = async (fn: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await act(() => new Promise((r) => setTimeout(r, 25)));
  }
};

describe('today.md footer', () => {
  let online = true;

  beforeEach(() => {
    setDesk(initialDesk());
    online = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!online) throw new TypeError('Failed to fetch');
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (String(url).startsWith('/api/sync') && init?.method === 'POST') {
          return new Response(JSON.stringify({ items: body.items ?? [], settings: DEFAULT_SETTINGS }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [], settings: null, chat: null, cursor: new Date().toISOString() }), { status: 200 });
      }),
    );
    loadState({ items: [], settings: DEFAULT_SETTINGS, chat: [], layout: [], cursor: new Date().toISOString() }, false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('says "All changes saved" after a successful save', async () => {
    render(<SaveStatusText />);
    act(() => void saveItem(makeItem({ title: 'fine' })));
    await until(() => S().saveStatus === 'saved' && !!screen.queryByText('All changes saved'));
    expect(screen.getByRole('status').textContent).toBe('All changes saved');
  });

  it('a failed save shows "Not saved" in red and keeps the change queued in IndexedDB', async () => {
    online = false;
    render(<SaveStatusText />);
    const it0 = makeItem({ title: 'do not lose me' });
    act(() => void saveItem(it0));
    await until(() => S().saveStatus === 'error');
    const el = screen.getByRole('status');
    expect(el.textContent).toBe('Not saved');
    expect(el.style.color).toBe('var(--mt-ink)');
    // Still on screen…
    expect(S().items[it0.id].title).toBe('do not lose me');
    // …and in IndexedDB, ready to go when the connection is back.
    const ob = await idbOutbox.load();
    expect(ob?.items[it0.id]?.title).toBe('do not lose me');

    online = true;
    window.dispatchEvent(new Event('online'));
    const { getEngine } = await import('@/lib/client/actions');
    await act(() => getEngine()!.flush());
    await until(() => S().saveStatus === 'saved');
    expect(screen.getByRole('status').textContent).toBe('All changes saved');
  });

  it('delete then undo puts the item back', async () => {
    const it0 = makeItem({ title: 'keep' });
    act(() => void saveItem(it0));
    act(() => deleteItem(it0.id));
    expect(S().items[it0.id]).toBeUndefined();
    expect(S().toast?.undo).toBe(true);
    act(() => undoDelete());
    expect(S().items[it0.id].title).toBe('keep');
  });
});
