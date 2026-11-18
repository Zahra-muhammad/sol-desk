// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerWin } from '@/components/TimerWin';
import { loadState } from '@/lib/client/actions';
import { S, initialDesk, setDesk } from '@/lib/client/store';
import { DEFAULT_SETTINGS } from '@/lib/shared/types';

beforeEach(() => {
  setDesk(initialDesk());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(JSON.stringify({ items: [], entries: body.entries ?? [], notes: [], settings: DEFAULT_SETTINGS }));
    }),
  );
  loadState({ items: [], entries: [], notes: [], alarms: [], settings: DEFAULT_SETTINGS, chat: [], layout: [], cursor: new Date().toISOString() }, false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const runningCount = () => Object.values(S().entries).filter((e) => !e.endedAt).length;

describe('timer.app buttons', () => {
  it('Stop stops — it never starts a new timer in the same click', () => {
    const v = render(<TimerWin />);
    const input = v.container.querySelector('.qa input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Website touch-ups' } });
    act(() => void fireEvent.click(v.getByRole('button', { name: 'Start' })));
    expect(runningCount()).toBe(1);
    act(() => void fireEvent.click(v.getByRole('button', { name: 'Stop' })));
    expect(runningCount()).toBe(0);
    expect(Object.values(S().entries)).toHaveLength(1);
  });

  it('Enter in the text box starts a timer', () => {
    const v = render(<TimerWin />);
    const input = v.container.querySelector('.qa input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Bazaar doc' } });
    act(() => void fireEvent.submit(input.form!));
    expect(runningCount()).toBe(1);
    // Enter again while running only saves the label — no second timer.
    act(() => void fireEvent.submit(input.form!));
    expect(runningCount()).toBe(1);
    expect(Object.values(S().entries)).toHaveLength(1);
  });
});
