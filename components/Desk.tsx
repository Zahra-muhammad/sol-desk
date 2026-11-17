'use client';

import { useEffect, useRef, useState } from 'react';
import {
  cancelChange,
  checkIdle,
  closeWin,
  flushForUnload,
  getEngine,
  loadState,
  lockNow,
  markActive,
  newItem,
  setDeskEl,
  topWin,
} from '@/lib/client/actions';
import { primeAudio, setSoundEnabled } from '@/lib/client/sound';
import { S, setDesk, useDesk, type LockMode } from '@/lib/client/store';
import { TODAY } from '@/lib/shared/dates';
import type { DeskState } from '@/lib/shared/types';
import { Ascii } from './Ascii';
import { DesktopIcons, MenuBar, RestorePill, StartMenu, Taskbar, Toast, XBig, hoverProps } from './Chrome';
import { LockScreen } from './LockScreen';
import { WindowFrame } from './WindowFrame';

export type DeskMode = 'set' | 'enter' | 'offline' | 'ok';

const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');

/**
 * The whole desk. Before login the server renders this with `initial = null`:
 * only the lock screen and empty chrome — no data reaches the browser until the password is accepted.
 */
export function Desk({ mode, initial, detail }: { mode: DeskMode; initial: DeskState | null; detail?: string }) {
  const [mounted, setMounted] = useState(false);
  const ready = useDesk((s) => s.ready);
  const locked = useDesk((s) => s.locked);
  const open = useDesk((s) => s.open);
  const formN = useDesk((s) => s.formN);
  const deskRef = useRef<HTMLDivElement>(null);

  // Boot.
  useEffect(() => {
    setDeskEl(deskRef.current);
    try {
      const v = localStorage.getItem('desk.sound');
      if (v != null) {
        const on = JSON.parse(v) === true;
        setSoundEnabled(on);
        setDesk((s) => ({ settings: { ...s.settings, sound: on } }));
      }
    } catch {
      /* ignore */
    }
    if (initial) loadState(initial, true);
    else setDesk({ locked: true, lockMode: (mode === 'ok' ? 'enter' : mode) as LockMode, lockDetail: detail ?? null });
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.classList.toggle('locked', locked);
  }, [locked]);

  // Global listeners: menus, shortcuts, activity, sync triggers.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const s = S();
      if (s.menu && !t.closest('[data-m]') && !t.closest('.drop')) setDesk({ menu: null });
      if (s.startOpen && !t.closest('#startm,#start')) setDesk({ startOpen: false });
    };
    const onKey = (e: KeyboardEvent) => {
      const s = S();
      if (s.locked) {
        if (e.key === 'Escape' && s.lockMode === 'change') cancelChange();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lockNow();
        return;
      }
      if (e.key === 'Escape') {
        if (s.menu || s.startOpen) {
          setDesk({ menu: null, startOpen: false });
          return;
        }
        const top = topWin();
        if (top && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '')) closeWin(top);
        else (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (e.key.toLowerCase() === 'n' && !typing() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        newItem('task');
      }
    };
    const onActivity = () => markActive();
    const onFirst = () => primeAudio();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkIdle();
        void getEngine()?.pull();
      }
    };
    const onFocus = () => {
      checkIdle();
      void getEngine()?.pull();
    };
    const onOnline = () => void getEngine()?.flush();
    const onHide = () => flushForUnload();

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) addEventListener(ev, onActivity, { passive: true });
    addEventListener('pointerdown', onFirst, { once: true });
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('focus', onFocus);
    addEventListener('online', onOnline);
    addEventListener('pagehide', onHide);
    addEventListener('beforeunload', onHide);

    const idle = setInterval(checkIdle, 15000);
    const poll = setInterval(() => {
      if (!document.hidden) void getEngine()?.pull();
      const e = getEngine();
      if (e && !e.isEmpty() && e.status === 'error') void e.flush();
    }, 30000);
    let lastDay = TODAY();
    const dayT = setInterval(() => {
      if (TODAY() !== lastDay) {
        lastDay = TODAY();
        setDesk({ selDay: lastDay });
      }
    }, 60000);

    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) removeEventListener(ev, onActivity);
      removeEventListener('pointerdown', onFirst);
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('focus', onFocus);
      removeEventListener('online', onOnline);
      removeEventListener('pagehide', onHide);
      removeEventListener('beforeunload', onHide);
      clearInterval(idle);
      clearInterval(poll);
      clearInterval(dayT);
    };
  }, []);

  const show = mounted && ready;
  return (
    <>
      <MenuBar ready={show} />
      <div id="desk" ref={deskRef} inert={locked}>
        <Ascii />
        <div id="icons" {...hoverProps}>
          {show && <DesktopIcons />}
        </div>
        {show && open.map((k) => <WindowFrame key={k === 'form' ? 'form-' + formN : k} k={k} />)}
      </div>
      <XBig />
      <RestorePill />
      <Taskbar ready={show} />
      <StartMenu ready={show} />
      <LockScreen />
      <Toast />
    </>
  );
}
