'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ICONS,
  W,
  clearDone,
  closeWin,
  downloadBackup,
  iconLabel,
  importBackup,
  lockNow,
  newItem,
  openWin,
  restoreWin,
  showDesktop,
  toggleSound,
  toggleTheme,
  topWin,
  undoDelete,
  unmaxAll,
  wname,
} from '@/lib/client/actions';
import { ask } from '@/lib/client/chat';
import { snd } from '@/lib/client/sound';
import { S, setDesk, useDesk, type WinKey } from '@/lib/client/store';
import { DesktopIcon, Glyph, LockIcon, MailIcon, SpeakerOff, SpeakerOn, StartIcon, SunIcon, Thumb } from './Glyphs';

// Hover tick (mouse only), once per item entered.
let lastHover: Element | null = null;
const onHoverItem = (e: React.PointerEvent) => {
  if (e.pointerType !== 'mouse') return;
  const b = (e.target as HTMLElement).closest('button');
  if (b && b !== lastHover) {
    lastHover = b;
    snd('tick');
  }
};
const onHoverOut = (e: React.PointerEvent) => {
  const to = e.relatedTarget as Node | null;
  if (!to || !(e.currentTarget as Node).contains(to)) lastHover = null;
};
export const hoverProps = { onPointerOver: onHoverItem, onPointerOut: onHoverOut };

/** Open a window from an icon / menu; keyboard users get focus moved into it. */
export function openFrom(k: WinKey, e?: React.MouseEvent) {
  openWin(k);
  snd('click');
  if (e && e.detail === 0) requestAnimationFrame(() => document.getElementById('w-' + k)?.focus());
}

const guard = (fn: () => void) => () => {
  if (S().locked) return;
  setDesk({ menu: null, startOpen: false });
  fn();
};

// ---------------------------------------------------------------- menu bar

function Menu({ id, label, ready, children }: { id: string; label: string; ready: boolean; children: React.ReactNode }) {
  const open = useDesk((s) => s.menu === id);
  return (
    <div className={`mi ${open ? 'open' : ''}`}>
      <button
        type="button"
        data-m
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          if (S().locked) return;
          setDesk({ menu: open ? null : id, startOpen: false });
          snd('click');
        }}
      >
        {label}
      </button>
      {ready && (
        <div className="drop" {...hoverProps}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuBar({ ready }: { ready: boolean }) {
  const locked = useDesk((s) => s.locked);
  const soundOn = useDesk((s) => s.settings.sound);
  const settings = useDesk((s) => s.settings);
  const open = useDesk((s) => s.open);
  const file = useRef<HTMLInputElement>(null);

  return (
    <div id="menu" inert={locked}>
      <Menu id="file" label="File" ready={ready}>
        <button type="button" onClick={guard(() => newItem('task'))}>
          New to-do <kbd>N</kbd>
        </button>
        <button type="button" onClick={guard(() => newItem('event'))}>
          New event
        </button>
        <button type="button" onClick={guard(() => newItem('meeting'))}>
          New meeting
        </button>
        <hr />
        <button type="button" onClick={guard(() => void downloadBackup())}>
          Download backup
        </button>
        <button type="button" onClick={guard(() => file.current?.click())}>
          Import backup…
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          aria-label="Backup file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importBackup(f);
          }}
        />
        <hr />
        <button type="button" onClick={guard(() => lockNow())}>
          Lock screen <kbd>⌃L</kbd>
        </button>
      </Menu>
      <Menu id="edit" label="Edit" ready={ready}>
        <button type="button" onClick={guard(undoDelete)}>
          Undo delete
        </button>
        <button type="button" onClick={guard(clearDone)}>
          Clear finished to-dos
        </button>
      </Menu>
      <Menu id="view" label="View" ready={ready}>
        {ICONS.map(([k]) => (
          <button
            key={k}
            type="button"
            onClick={guard(() => (S().open.includes(k) ? closeWin(k) : openWin(k)))}
          >
            {iconLabel(k, settings)}
            <kbd>{open.includes(k) ? '●' : ''}</kbd>
          </button>
        ))}
        <hr />
        <button type="button" onClick={guard(showDesktop)}>
          Show desktop
        </button>
        <button type="button" onClick={guard(toggleTheme)}>
          Light / dark
        </button>
      </Menu>
      <Menu id="tools" label="Tools" ready={ready}>
        <button type="button" onClick={guard(() => void ask('Plan my day'))}>
          Plan my day
        </button>
        <button type="button" onClick={guard(() => void ask('Plan my week'))}>
          Plan my week
        </button>
        <button type="button" onClick={guard(() => void ask('What am I forgetting?'))}>
          What am I forgetting?
        </button>
        <hr />
        <button type="button" className="sndl" onClick={guard(toggleSound)}>
          Sound: {soundOn ? 'on' : 'off'}
        </button>
        <button type="button" onClick={guard(() => lockNow('change'))}>
          Change password
        </button>
      </Menu>
      <div className="tray">
        <button type="button" className="ib" id="sndb" title="Sound" aria-label={soundOn ? 'Sound on' : 'Sound off'} aria-pressed={soundOn} onClick={guard(toggleSound)}>
          {soundOn ? <SpeakerOn /> : <SpeakerOff />}
        </button>
        <button type="button" className="ib" title="Lock" aria-label="Lock screen" onClick={guard(() => lockNow())}>
          <LockIcon />
        </button>
        <button type="button" className="ib" title="Light / dark" aria-label="Light / dark" onClick={guard(toggleTheme)}>
          <SunIcon />
        </button>
        <button type="button" className="ib hm" title="Show desktop" aria-label="Show desktop" onClick={guard(showDesktop)}>
          <DesktopIcon />
        </button>
        <button
          type="button"
          className="ib hm"
          title="Planner"
          aria-label="Planner"
          onClick={(e) => {
            if (S().locked) return;
            openFrom('chat', e);
          }}
        >
          <MailIcon />
        </button>
        <Clocks />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- clocks: DXB → LON → KHI → NYC

const CITIES: [string, string][] = [
  ['DXB', 'Asia/Dubai'],
  ['LON', 'Europe/London'],
  ['KHI', 'Asia/Karachi'],
  ['NYC', 'America/New_York'],
];
const fmtTz = (tz: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date());
  } catch {
    return '--:--';
  }
};

export function Clocks() {
  const [ci, setCi] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => {
      const d = inner.current;
      if (!d) return;
      d.style.transform = 'translateY(-22px)';
      setTimeout(() => {
        flushSync(() => setCi((c) => (c + 1) % CITIES.length));
        d.style.transition = 'none';
        d.style.transform = 'translateY(18px)';
        requestAnimationFrame(() => {
          d.style.transition = '';
          d.style.transform = '';
        });
      }, 500);
    }, 3500);
    return () => clearInterval(t);
  }, []);
  const pairs = [0, 1].map((o) => CITIES[(ci + o) % CITIES.length]);
  return (
    <div className="clk" id="clk">
      <div ref={inner}>
        {mounted &&
          pairs.map(([c, tz]) => (
            <span key={c} style={{ margin: 0 }}>
              <b>{fmtTz(tz)}</b>
              <span>{c}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- desktop icons

export function DesktopIcons() {
  const settings = useDesk((s) => s.settings);
  const top = useDesk((s) => s.stack[s.stack.length - 1]);
  return (
    <>
      {ICONS.map(([k]) => (
        <button key={k} type="button" className={`ic ${top === k ? 'sel' : ''}`} onClick={(e) => openFrom(k, e)}>
          <Thumb k={k} />
          <span>{iconLabel(k, settings)}</span>
        </button>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- taskbar + start menu

export function Taskbar({ ready }: { ready: boolean }) {
  const open = useDesk((s) => s.open);
  const top = useDesk((s) => s.stack[s.stack.length - 1]);
  const startOpen = useDesk((s) => s.startOpen);
  // Joined into one string so the selector result is stable between renders.
  const names = useDesk((s) => s.open.map((k) => wname(k, s.settings, s.items, s.editing)).join('\u0000'));
  const locked = useDesk((s) => s.locked);
  const labels = names.split('\u0000');
  return (
    <div id="task" inert={locked}>
      <button
        type="button"
        id="start"
        aria-haspopup="true"
        aria-expanded={startOpen}
        onClick={() => {
          if (S().locked) return;
          setDesk({ startOpen: !S().startOpen, menu: null });
          snd('click');
        }}
      >
        <StartIcon />
        start
      </button>
      <div id="tasks" style={{ display: 'flex', gap: 6 }}>
        {ready &&
          open.map((k, i) => (
            <button
              key={k}
              type="button"
              className={`tk ${top === k ? 'on' : ''}`}
              onClick={(e) => {
                if (topWin() === k) {
                  closeWin(k);
                  return;
                }
                openWin(k);
                snd('tick');
                if (e.detail === 0) requestAnimationFrame(() => document.getElementById('w-' + k)?.focus());
              }}
            >
              <Glyph kind={W[k].icon} />
              {labels[i]}
            </button>
          ))}
      </div>
    </div>
  );
}

export function StartMenu({ ready }: { ready: boolean }) {
  const open = useDesk((s) => s.startOpen);
  const settings = useDesk((s) => s.settings);
  if (!ready) return <div id="startm" />;
  const go = (fn: () => void) => () => {
    setDesk({ startOpen: false });
    fn();
  };
  return (
    <div id="startm" className={open ? 'open' : ''} aria-label="Start" {...hoverProps}>
      <h4>New</h4>
      <button type="button" onClick={go(() => (newItem('task'), snd('click')))}>
        <span className="sw" style={{ background: 'var(--faint)' }} />
        To-do
      </button>
      <button type="button" onClick={go(() => (newItem('event'), snd('click')))}>
        <span className="sw" style={{ background: 'var(--ev)' }} />
        Event
      </button>
      <button type="button" onClick={go(() => (newItem('meeting'), snd('click')))}>
        <span className="sw" style={{ background: 'var(--mt)', borderRadius: '50%' }} />
        Meeting
      </button>
      <h4>Planner</h4>
      <button type="button" onClick={go(() => void ask('Plan my day'))}>
        Plan my day
      </button>
      <button type="button" onClick={go(() => void ask('Plan my week'))}>
        Plan my week
      </button>
      <h4>Open</h4>
      {ICONS.map(([k]) => (
        <button key={k} type="button" onClick={(e) => (setDesk({ startOpen: false }), openFrom(k, e))}>
          <Thumb k={k} style={{ width: 26, height: 21, borderRadius: 5 }} />
          {iconLabel(k, settings)}
        </button>
      ))}
      <button type="button" onClick={go(showDesktop)}>
        Show desktop
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- little overlays

export function Toast() {
  const t = useDesk((s) => s.toast);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!t) return;
    setOn(true);
    const h = setTimeout(() => setOn(false), 4500);
    return () => clearTimeout(h);
  }, [t?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div id="toast" className={on ? 'on' : ''} role="status" aria-live="polite">
      <span>{t?.msg}</span>
      <button type="button" style={{ display: t?.undo ? '' : 'none' }} onClick={() => (undoDelete(), setOn(false))}>
        Undo
      </button>
    </div>
  );
}

export function RestorePill() {
  const n = useDesk((s) => s.restoreN);
  const count = useDesk((s) => s.closed.length);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!n) return;
    setOn(true);
    const h = setTimeout(() => setOn(false), 6000);
    return () => clearTimeout(h);
  }, [n]);
  return (
    <button type="button" id="restore" className={on && count ? 'on' : ''} onClick={restoreWin}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2v3h3" />
      </svg>
      <span>Restore ({count})</span>
    </button>
  );
}

export function XBig() {
  const any = useDesk((s) => s.maxed.length > 0);
  return (
    <button type="button" id="xbig" className={any ? 'on' : ''} aria-label="Exit full size" onClick={unmaxAll}>
      <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="m3 3 10 10M13 3 3 13" />
      </svg>
    </button>
  );
}
