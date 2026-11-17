// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  continueEntry,
  deleteEntry,
  deleteNote,
  getEngine,
  loadState,
  newNote,
  startTimer,
  stopTimer,
  undoDelete,
  updateNote,
  updateRunning,
} from '@/lib/client/actions';
import { S, initialDesk, setDesk } from '@/lib/client/store';
import { running } from '@/lib/shared/time';
import { DEFAULT_SETTINGS } from '@/lib/shared/types';

const pushed: { entries?: unknown[]; notes?: unknown[] }[] = [];

beforeEach(() => {
  pushed.length = 0;
  setDesk(initialDesk());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(url).startsWith('/api/sync') && init?.method === 'POST') {
        pushed.push(body);
        return new Response(JSON.stringify({ items: [], entries: body.entries ?? [], notes: body.notes ?? [], settings: DEFAULT_SETTINGS }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }),
  );
  loadState({ items: [], entries: [], notes: [], settings: DEFAULT_SETTINGS, chat: [], layout: [], cursor: new Date().toISOString() }, false);
});

const entries = () => Object.values(S().entries);
const settle = () => act(async () => void (await getEngine()!.flush()));

describe('timer', () => {
  it('starts, renames while running, stops — and saves each step', async () => {
    act(() => startTimer('Website touch-ups', 'p1'));
    const r = running(entries());
    expect(r).toMatchObject({ label: 'Website touch-ups', project: 'p1', endedAt: null });
    act(() => updateRunning({ label: 'Website fixes' }));
    expect(running(entries())?.label).toBe('Website fixes');
    act(() => stopTimer());
    expect(running(entries())).toBeNull();
    expect(entries()[0].endedAt).not.toBeNull();
    await settle();
    const sent = pushed.flatMap((b) => (b.entries ?? []) as { endedAt: string | null }[]);
    expect(sent.at(-1)?.endedAt).not.toBeNull();
  });

  it('only one timer runs at a time; continue starts a fresh one', () => {
    act(() => startTimer('A', null));
    act(() => startTimer('B', 'p2'));
    expect(entries().filter((e) => !e.endedAt).map((e) => e.label)).toEqual(['B']);
    const a = entries().find((e) => e.label === 'A')!;
    act(() => continueEntry(a.id));
    const run = running(entries())!;
    expect(run.label).toBe('A');
    expect(run.id).not.toBe(a.id);
  });

  it('delete has Undo', () => {
    act(() => startTimer('oops', null));
    const id = entries()[0].id;
    act(() => deleteEntry(id));
    expect(S().entries[id]).toBeUndefined();
    expect(S().toast?.undo).toBe(true);
    act(() => undoDelete());
    expect(S().entries[id]?.label).toBe('oops');
  });
});

describe('notebook', () => {
  it('new note, edit, delete with Undo — all saved', async () => {
    act(() => newNote());
    const id = S().noteSel!;
    expect(S().notes[id]).toBeTruthy();
    act(() => updateNote(id, { title: 'Bazaar doc outline' }));
    act(() => updateNote(id, { body: '1. intro\n2. pricing' }));
    expect(S().notes[id]).toMatchObject({ title: 'Bazaar doc outline', body: '1. intro\n2. pricing' });
    await settle();
    const sent = pushed.flatMap((b) => (b.notes ?? []) as { title: string; body: string }[]);
    expect(sent.at(-1)).toMatchObject({ title: 'Bazaar doc outline', body: '1. intro\n2. pricing' });

    act(() => deleteNote(id));
    expect(S().notes[id]).toBeUndefined();
    act(() => undoDelete());
    expect(S().notes[id]?.title).toBe('Bazaar doc outline');
    expect(S().noteSel).toBe(id);
  });
});
