'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { addAlarm, deleteAlarm, dismissAlarm, snoozeAlarm } from '@/lib/client/actions';
import { ask } from '@/lib/client/chat';
import { useNow } from '@/lib/client/hooks';
import { snd } from '@/lib/client/sound';
import { useDesk } from '@/lib/client/store';
import { fmtAlarmTime, fmtCountdown, missed, parseAlarm, ringing, upcoming } from '@/lib/shared/alarm';
import { iso, pad } from '@/lib/shared/dates';
import type { Alarm } from '@/lib/shared/types';

const hm = (isoTs: string) => {
  const d = new Date(isoTs);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};

function useAlarms() {
  const map = useDesk((s) => s.alarms);
  return useMemo(() => Object.values(map), [map]);
}

const Bell = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z" />
    <path d="M6.5 14a1.5 1.5 0 0 0 3 0" />
  </svg>
);

const X = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

function AlarmRow({ a, state }: { a: Alarm; state: 'up' | 'ring' | 'missed' | 'done' }) {
  const label = a.label || 'Timer';
  const notToday = iso(new Date(a.at)) !== iso(new Date());
  const due =
    state === 'up'
      ? (notToday ? fmtAlarmTime(a.at).replace(/ \d\d:\d\d$/, '') + ' · ' : '') + fmtCountdown(Date.parse(a.at) - Date.now())
      : state === 'ring'
        ? 'ringing'
        : state === 'missed'
          ? 'missed'
          : 'done';
  return (
    <div className={`row te al ${state}`}>
      <span className="tm">{hm(a.at)}</span>
      <span className="ti">{label}</span>
      <span className={`due ${state === 'ring' || state === 'missed' ? 'late' : ''}`}>{due}</span>
      {(state === 'ring' || state === 'missed') && (
        <button type="button" className="rb" title="Dismiss" aria-label={`Dismiss “${label}”`} onClick={() => dismissAlarm(a.id)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </button>
      )}
      <button type="button" className="rb" title="Delete" aria-label={`Delete alarm “${label}”`} onClick={() => deleteAlarm(a.id)}>
        <X />
      </button>
    </div>
  );
}

const QUICK: [number, string][] = [
  [5, '5 min'],
  [15, '15 min'],
  [25, '25 min'],
  [60, '1 hour'],
];

/** alarms.app — alarms and countdowns that ring. */
export function AlarmsWin() {
  useNow(1000);
  const all = useAlarms();
  const [msg, setMsg] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const now = Date.now();
  const up = upcoming(all, now);
  const ring = ringing(all, now);
  const miss = missed(all, now);
  const earlier = all
    .filter((a) => !a.deletedAt && a.dismissedAt && now - Date.parse(a.at) < 2 * 864e5)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return (
    <>
      <p className="sub">Alarms &amp; timers</p>
      <form
        className="qa"
        onSubmit={(e) => {
          e.preventDefault();
          const v = input.current?.value.trim() ?? '';
          if (!v) return;
          const p = parseAlarm(v);
          if (!p) {
            setMsg('Try “4pm”, “25 min” or “tomorrow 9am gym”.');
            snd('err');
            return;
          }
          addAlarm(p.label, p.at);
          setMsg(`Set for ${fmtAlarmTime(p.at.toISOString())} · ${fmtCountdown(p.at.getTime() - Date.now())}`);
          if (input.current) input.current.value = '';
        }}
      >
        <input ref={input} name="q" placeholder="“4pm”, “25 min”, “tomorrow 9am gym”" aria-label="New alarm or timer" autoComplete="off" />
        <button className="btn">Set</button>
      </form>
      {msg && (
        <p className="tnow" role="status">
          {msg}
        </p>
      )}
      <div className="bar">
        <div className="seg" role="group" aria-label="Quick timers">
          {QUICK.map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                const at = new Date(Date.now() + m * 60e3);
                addAlarm(`${label} timer`, at);
                setMsg(`${label} timer · rings at ${hm(at.toISOString())}`);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {ring.length > 0 && (
        <>
          <div className="hd">Ringing</div>
          {ring.map((a) => (
            <AlarmRow key={a.id} a={a} state="ring" />
          ))}
        </>
      )}
      <div className="hd">
        Coming up <span>{up.length || ''}</span>
      </div>
      {up.length ? up.map((a) => <AlarmRow key={a.id} a={a} state="up" />) : <p className="empty">No alarms set.</p>}
      {miss.length > 0 && (
        <>
          <div className="hd">Missed</div>
          {miss.map((a) => (
            <AlarmRow key={a.id} a={a} state="missed" />
          ))}
        </>
      )}
      {earlier.length > 0 && (
        <>
          <div className="hd">Earlier</div>
          {earlier.map((a) => (
            <AlarmRow key={a.id} a={a} state="done" />
          ))}
        </>
      )}
    </>
  );
}

export function AlarmsFooter() {
  useNow(30e3);
  const n = upcoming(useAlarms()).length;
  return (
    <>
      <span>{n ? `${n} coming up` : 'Nothing set'}</span>
      <button type="button" onClick={() => void ask('Set an alarm 10 minutes before each of my meetings and events today')}>
        Before my meetings →
      </button>
    </>
  );
}

/** Menu-bar pill: the next alarm today (or "ringing"). Click to open alarms.app. */
export function TrayAlarm({ onOpen }: { onOpen: (e: React.MouseEvent) => void }) {
  useNow(15e3);
  const ready = useDesk((s) => s.ready);
  const all = useAlarms();
  if (!ready) return null;
  const now = Date.now();
  const ring = ringing(all, now)[0];
  const next = upcoming(all, now)[0];
  if (!ring && !(next && Date.parse(next.at) - now < 24 * 3600e3)) return null;
  const a = ring ?? next!;
  return (
    <button
      type="button"
      className={`ib tmr alp ${ring ? 'ringing' : ''}`}
      title={`${ring ? 'Ringing' : 'Next alarm'}: ${a.label || 'Timer'}`}
      aria-label={ring ? 'Alarm ringing. Open alarms' : `Next alarm at ${hm(a.at)}. Open alarms`}
      onClick={onOpen}
    >
      <Bell />
      {ring ? 'now' : hm(a.at)}
    </button>
  );
}

/**
 * The ringing card. Shows over everything (even the lock screen, without the label), repeats the
 * alarm sound until dismissed or snoozed, and sends a system notification when the tab is in the background.
 */
export function AlarmRinger() {
  useNow(1000);
  const all = useAlarms();
  const ready = useDesk((s) => s.ready);
  const locked = useDesk((s) => s.locked);
  const ring = ready ? ringing(all) : [];
  const a = ring[0];
  const notified = useRef(new Set<string>());

  // Repeat the ring while something is ringing.
  useEffect(() => {
    if (!a) return;
    snd('alarm');
    const t = setInterval(() => snd('alarm'), 1600);
    return () => clearInterval(t);
  }, [a?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab title + system notification.
  useEffect(() => {
    if (!a) return;
    const base = document.title.replace(/^⏰ /, '');
    document.title = '⏰ ' + base;
    if (document.hidden && !notified.current.has(a.id)) {
      notified.current.add(a.id);
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`Alarm · ${hm(a.at)}`, { body: locked ? 'Your desk alarm is ringing.' : a.label || 'Timer', tag: a.id });
        }
      } catch {
        /* not supported */
      }
    }
    return () => {
      document.title = base;
    };
  }, [a?.id, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return null;
  return (
    <div id="ring" role="alertdialog" aria-live="assertive" aria-label={`Alarm ${hm(a.at)}`}>
      <div className="rt">
        <span className="rbell">
          <Bell />
        </span>
        <div>
          <b>{hm(a.at)}</b>
          <span>{locked ? 'Alarm' : a.label || 'Timer'}</span>
          {ring.length > 1 && <span> · +{ring.length - 1} more</span>}
        </div>
      </div>
      <div className="ra">
        <button type="button" className="btn gh" onClick={() => snoozeAlarm(a.id)}>
          Snooze 5 min
        </button>
        <button type="button" className="btn" onClick={() => dismissAlarm(a.id)} autoFocus>
          Dismiss
        </button>
      </div>
    </div>
  );
}
