'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { continueEntry, deleteEntry, startTimer, stopTimer, updateRunning } from '@/lib/client/actions';
import { ask } from '@/lib/client/chat';
import { debounced, flushDebounced } from '@/lib/client/debounce';
import { useNow } from '@/lib/client/hooks';
import { snd } from '@/lib/client/sound';
import { pname, setDesk, useDesk } from '@/lib/client/store';
import { TODAY, pad } from '@/lib/shared/dates';
import { entryMs, fmtClock, fmtDur, running, startedOn, totals, weekStart } from '@/lib/shared/time';
import type { ProjectKey, TimeEntry } from '@/lib/shared/types';

const hm = (isoTs: string) => {
  const d = new Date(isoTs);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};

const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

function useEntries() {
  const map = useDesk((s) => s.entries);
  return useMemo(() => Object.values(map), [map]);
}

/** The big ticking clock. Re-renders every second on its own so the rest of the window doesn't have to. */
function Clock() {
  useNow(1000);
  const r = running(useEntries());
  return (
    <div className={`tclock ${r ? 'on' : ''}`} role="timer" aria-label={r ? `Running for ${fmtClock(entryMs(r))}` : 'Timer stopped'}>
      {fmtClock(r ? entryMs(r) : 0)}
    </div>
  );
}

function EntryRow({ e }: { e: TimeEntry }) {
  useNow(e.endedAt ? 3600e3 : 30e3);
  const settings = useDesk((s) => s.settings);
  const label = e.label || 'No label';
  return (
    <div className="row te">
      <span className="tm">{hm(e.startedAt)}</span>
      <span className="ti">{label}</span>
      {e.project && <span className={`pj ${e.project}`}>{pname(settings, e.project)}</span>}
      <span className="due">{e.endedAt ? fmtDur(entryMs(e)) : 'running'}</span>
      <button type="button" className="rb" title="Continue" aria-label={`Continue “${label}”`} onClick={() => continueEntry(e.id)}>
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M4.5 3v10l8-5z" />
        </svg>
      </button>
      <button type="button" className="rb" title="Delete" aria-label={`Delete “${label}”`} onClick={() => deleteEntry(e.id)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

/** timer.app — start/stop, what it's for, today's sessions and this week's totals. */
export function TimerWin() {
  useNow(30e3);
  const all = useEntries();
  const settings = useDesk((s) => s.settings);
  const items = useDesk((s) => s.items);
  const draftLabel = useDesk((s) => s.timerLabel);
  const draftProject = useDesk((s) => s.timerProject);
  const r = running(all);

  // The text box edits the running timer's label, or the label for the next one.
  const [text, setText] = useState(r ? r.label : draftLabel);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(r ? r.label : draftLabel);
  }, [r?.id, r?.label, draftLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const project: '' | ProjectKey = r ? (r.project ?? '') : draftProject;
  const today = startedOn(all, TODAY());
  const tDay = totals(all, startOfToday());
  const tWeek = totals(all, weekStart());
  const suggestions = useMemo(
    () => [...new Set(Object.values(items).filter((x) => x.type === 'task' && !x.done).map((x) => x.title))].slice(0, 40),
    [items],
  );
  const projects: ['' | ProjectKey, string][] = [
    ['', 'No project'],
    ['p1', settings.p1.name],
    ['p2', settings.p2.name],
  ];
  const weekRows: [ProjectKey | 'none', string, string][] = [
    ['p1', settings.p1.name, 'var(--p1)'],
    ['p2', settings.p2.name, 'var(--p2)'],
    ['none', 'No project', 'var(--faint)'],
  ];

  return (
    <>
      <p className="sub">Time tracking</p>
      <Clock />
      <p className="tnow">{r ? `${r.label || 'No label'} · since ${hm(r.startedAt)}` : 'Not running'}</p>
      <form
        className="qa"
        onSubmit={(e) => {
          e.preventDefault();
          if (r) {
            flushDebounced('timer.label');
            (document.activeElement as HTMLElement | null)?.blur();
            return;
          }
          startTimer(text, project || null);
        }}
      >
        <input
          name="q"
          list="timer-suggest"
          value={text}
          placeholder="What are you working on?"
          aria-label="What are you working on?"
          autoComplete="off"
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            flushDebounced('timer.label');
          }}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (r) debounced('timer.label', () => updateRunning({ label: v.trim() }), 700);
            else setDesk({ timerLabel: v });
          }}
        />
        {r ? (
          <button type="button" className="btn tstop" onClick={() => stopTimer()}>
            Stop
          </button>
        ) : (
          <button className="btn">Start</button>
        )}
      </form>
      <datalist id="timer-suggest">
        {suggestions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="bar">
        <div className="seg" role="group" aria-label="Project">
          {projects.map(([k, v]) => (
            <button
              key={k || 'none'}
              type="button"
              className={project === k ? 'on' : ''}
              aria-pressed={project === k}
              onClick={() => {
                if (r) updateRunning({ project: k || null });
                else setDesk({ timerProject: k });
                snd('tick');
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="hd">
        Today <span>{fmtDur(tDay.total)}</span>
      </div>
      {today.length ? today.map((e) => <EntryRow key={e.id} e={e} />) : <p className="empty">Nothing tracked yet today.</p>}

      <div className="hd">
        This week <span>{fmtDur(tWeek.total)}</span>
      </div>
      {tWeek.total ? (
        weekRows
          .filter(([k]) => tWeek.byProject[k] > 0)
          .map(([k, name, color]) => (
            <div className="tw" key={k}>
              <span className="twl">{name}</span>
              <div className="meter" role="img" aria-label={`${name}: ${fmtDur(tWeek.byProject[k])}`}>
                <i style={{ width: Math.max(2, Math.round((tWeek.byProject[k] / tWeek.total) * 100)) + '%', background: color }} />
              </div>
              <span className="due">{fmtDur(tWeek.byProject[k])}</span>
            </div>
          ))
      ) : (
        <p className="empty">No time tracked this week.</p>
      )}
    </>
  );
}

export function TimerFooter() {
  useNow(30e3);
  const all = useEntries();
  return (
    <>
      <span>
        {fmtDur(totals(all, startOfToday()).total)} today · {fmtDur(totals(all, weekStart()).total)} this week
      </span>
      <button type="button" onClick={() => void ask('Look at the time I tracked this week and tell me how I’m splitting it between my projects')}>
        Review my time →
      </button>
    </>
  );
}

/** The menu-bar pill while a timer runs. Click to open timer.app. */
export function TrayTimer({ onOpen }: { onOpen: (e: React.MouseEvent) => void }) {
  useNow(1000);
  const ready = useDesk((s) => s.ready);
  const r = running(useEntries());
  if (!ready || !r) return null;
  const t = fmtClock(entryMs(r));
  return (
    <button type="button" className="ib tmr" title={`Timer: ${r.label || 'No label'}`} aria-label={`Timer running, ${t}. Open timer`} onClick={onOpen}>
      <i className="tdot" aria-hidden="true" />
      {t}
    </button>
  );
}
