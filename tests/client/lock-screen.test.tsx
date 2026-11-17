// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LockScreen } from '@/components/LockScreen';
import { initialDesk, setDesk } from '@/lib/client/store';
import { DEFAULT_SETTINGS } from '@/lib/shared/types';

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url === '/api/state') return new Response(JSON.stringify({ items: [], settings: DEFAULT_SETTINGS, chat: [], layout: [], cursor: new Date().toISOString() }));
  return new Response(JSON.stringify({ ok: true }));
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  setDesk({ ...initialDesk(), locked: true, lockMode: 'set' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 80)));

function setup() {
  const view = render(<LockScreen />);
  const pw1 = view.container.querySelector('#pw1 input') as HTMLInputElement;
  const pw2 = view.container.querySelector('#pw2 input') as HTMLInputElement;
  const form = view.container.querySelector('form') as HTMLFormElement;
  const msg = () => view.container.querySelector('#lmsg')!.textContent;
  const submit = async (input: HTMLInputElement, v: string) => {
    fireEvent.change(input, { target: { value: v } });
    input.value = v;
    fireEvent.submit(form);
    await flush();
  };
  return { pw1, pw2, msg, submit, view };
}

describe('lock screen: 4-number password', () => {
  it('asks for 4 numbers and brings up the number keypad', () => {
    const { pw1, pw2, msg, view } = setup();
    expect(msg()).toBe('Choose a 4-number password for your desk. Only you will know it.');
    expect(view.container.querySelector('#lhint')!.textContent).toMatch(/4 numbers/);
    for (const el of [pw1, pw2]) {
      expect(el.getAttribute('inputmode')).toBe('numeric');
      expect(el.maxLength).toBe(4);
    }
  });

  it('refuses letters or the wrong length', async () => {
    const { pw1, msg, submit } = setup();
    for (const bad of ['abcd', '123', '12a4']) {
      await submit(pw1, bad);
      expect(msg()).toBe('Use exactly 4 numbers.');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs the same 4 numbers twice, then saves them', async () => {
    const { pw1, pw2, msg, submit } = setup();
    await submit(pw1, '4821');
    expect(msg()).toBe('Type it once more to confirm.');
    await submit(pw2, '4822');
    expect(msg()).toBe('Those didn’t match — try again.');
    expect(fetchMock).not.toHaveBeenCalled();

    await submit(pw1, '4821');
    await submit(pw2, '4821');
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/auth/setup');
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call![1]!.body))).toEqual({ password: '4821' });
  });
});
