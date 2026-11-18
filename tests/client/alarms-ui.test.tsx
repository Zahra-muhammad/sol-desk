// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlarmRinger, AlarmsWin } from '@/components/AlarmsWin';
import { loadState } from '@/lib/client/actions';
import { S, initialDesk, setDesk } from '@/lib/client/store';
import { DEFAULT_SETTINGS } from '@/lib/shared/types';

beforeEach(() => {
  setDesk(initialDesk());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init?: RequestInit) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(JSON.stringify({ items: [], entries: [], notes: [], alarms: b.alarms ?? [], settings: DEFAULT_SETTINGS }));
    }),
  );
  loadState({ items: [], entries: [], notes: [], alarms: [], settings: DEFAULT_SETTINGS, chat: [], layout: [], cursor: new Date().toISOString() }, false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('alarms.app', () => {
  it('“25 min” sets a countdown that shows under Coming up', () => {
    const v = render(<AlarmsWin />);
    const input = v.container.querySelector('.qa input') as HTMLInputElement;
    input.value = '25 min tea';
    act(() => void fireEvent.submit(input.form!));
    const a = Object.values(S().alarms)[0];
    expect(a.label).toBe('tea');
    expect(Date.parse(a.at) - Date.now()).toBeGreaterThan(24 * 60e3);
    expect(v.container.textContent).toContain('tea');
    expect(v.container.textContent).toMatch(/in 2[45]m/);
  });

  it('a due alarm rings; Dismiss stops it, Snooze moves it 5 min', () => {
    const t = new Date(Date.now() - 5000).toISOString();
    setDesk({ alarms: { a1: { id: 'a1', label: 'Leave', at: t, dismissedAt: null, createdAt: t, updatedAt: t, deletedAt: null } } });
    const v = render(<AlarmRinger />);
    expect(v.getByRole('alertdialog').textContent).toContain('Leave');
    act(() => void fireEvent.click(v.getByRole('button', { name: 'Snooze 5 min' })));
    expect(Date.parse(S().alarms.a1.at) - Date.now()).toBeGreaterThan(4 * 60e3);
    expect(v.queryByRole('alertdialog')).toBeNull();
    setDesk((s) => ({ alarms: { a1: { ...s.alarms.a1, at: t } } }));
    v.rerender(<AlarmRinger />);
    act(() => void fireEvent.click(v.getByRole('button', { name: 'Dismiss' })));
    expect(S().alarms.a1.dismissedAt).not.toBeNull();
  });

  it('on the lock screen it rings without showing the label', () => {
    const t = new Date(Date.now() - 1000).toISOString();
    setDesk({ locked: true, alarms: { a2: { id: 'a2', label: 'Secret plan', at: t, dismissedAt: null, createdAt: t, updatedAt: t, deletedAt: null } } });
    const v = render(<AlarmRinger />);
    expect(v.getByRole('alertdialog').textContent).not.toContain('Secret plan');
  });
});
