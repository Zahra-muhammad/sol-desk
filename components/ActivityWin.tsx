'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '@/lib/client/api';
import { ask } from '@/lib/client/chat';
import { snd } from '@/lib/client/sound';
import { setDesk, useDesk } from '@/lib/client/store';
import { EMPTY_DAY, level, score, yearStats, yearWeeks, type DayActivity, type YearActivity } from '@/lib/shared/activity';
import { DOW, MON, TODAY, parse } from '@/lib/shared/dates';
import { fmtDur } from '@/lib/shared/time';

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
};

const longDay = (d: string) => {
  const x = parse(d);
  return `${DOW[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}`;
};

/** "3 unlocks · 2 to-dos done · 1h 10m tracked" */
export function breakdown(a: DayActivity): string {
  const parts = [
    a.logins && `${a.logins} unlock${a.logins === 1 ? '' : 's'}`,
    a.added && `${a.added} added`,
    a.done && `${a.done} to-do${a.done === 1 ? '' : 's'} done`,
    a.minutes && `${fmtDur(a.minutes * 60e3)} tracked`,
    a.notes && `${a.notes} note${a.notes === 1 ? '' : 's'}`,
    a.alarms && `${a.alarms} alarm${a.alarms === 1 ? '' : 's'}`,
    a.chats && `${a.chats} planner message${a.chats === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.join(' · ') || 'Nothing that day.';
}

/** Fetch a year's activity; refresh every minute while the window is open so today's square fills in. */
function useActivity(year: number) {
  const act = useDesk((s) => s.act);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await call<{ year: number; days: YearActivity }>(`/api/activity?year=${year}&tz=${encodeURIComponent(tz())}`);
      if (!live) return;
      if (r.ok) {
        setDesk({ act: r.data });
        setError(false);
      } else setError(true);
    };
    void load();
    const t = setInterval(load, 60e3);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [year]);
  return { days: act && act.year === year ? act.days : null, error };
}

/** activity.app — a GitHub-style year of activity. */
export function ActivityWin() {
  const year = useDesk((s) => s.actYear);
  const { days, error } = useActivity(year);
  const [sel, setSel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const today = TODAY();
  const thisYear = new Date().getFullYear();
  const weeks = useMemo(() => yearWeeks(year), [year]);
  const stats = useMemo(() => yearStats(year, days ?? {}, today), [year, days, today]);

  // Month labels sit above the week column holding the 1st of each month.
  const months = weeks.map((w) => {
    const first = w.find((d) => d && d.endsWith('-01'));
    return first ? MON[+first.slice(5, 7) - 1].slice(0, 3) : '';
  });

  // On narrow screens, start scrolled to the latest weeks.
  useEffect(() => {
    const el = scroller.current;
    if (el && year === thisYear) el.scrollLeft = el.scrollWidth;
  }, [year, thisYear, days]);

  const shown = sel ?? (year === thisYear ? today : null);
  const shownDay = shown ? (days?.[shown] ?? EMPTY_DAY) : null;
  const go = (y: number) => {
    setDesk({ actYear: y });
    setSel(null);
    snd('click');
  };

  return (
    <div className="act">
      <div className="calh">
        <b>
          {days ? stats.total : '…'} {stats.total === 1 ? 'activity' : 'activities'} in {year}
        </b>
        <button type="button" className="btn gh" aria-label="Previous year" onClick={() => go(year - 1)}>
          ‹
        </button>
        <button type="button" className="btn gh" onClick={() => go(thisYear)}>
          This year
        </button>
        <button type="button" className="btn gh" aria-label="Next year" disabled={year >= thisYear} onClick={() => go(year + 1)}>
          ›
        </button>
      </div>
      <p className="sub">
        {error && !days
          ? 'Couldn’t load your activity — check your connection.'
          : `${stats.activeDays} active day${stats.activeDays === 1 ? '' : 's'} · current streak ${stats.currentStreak} · longest streak ${stats.longestStreak}`}
      </p>

      <div className="hm" ref={scroller}>
        <div className="hm-in" style={{ ['--weeks' as string]: weeks.length }}>
          <div className="hm-months" aria-hidden="true">
            {months.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          {/* Weeks start on Monday, so the first row is Monday. */}
          <div className="hm-days" aria-hidden="true">
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
            <span />
          </div>
          <div className="hm-grid" role="img" aria-label={`Activity in ${year}: ${stats.activeDays} active days, ${stats.total} activities`}>
            {weeks.flatMap((w, wi) =>
              w.map((d, di) => {
                if (!d) return <i key={`${wi}-${di}`} className="pad" />;
                const sc = score(days?.[d]);
                return (
                  <i
                    key={d}
                    className={`l${level(sc, stats.max)} ${d === today ? 'td' : ''} ${d === shown ? 'sl' : ''}`}
                    title={`${sc} ${sc === 1 ? 'activity' : 'activities'} on ${longDay(d)}`}
                    onMouseEnter={() => setSel(d)}
                    onClick={() => setSel(d)}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>
      <div className="hm-legend" aria-hidden="true">
        Less <i className="l0" />
        <i className="l1" />
        <i className="l2" />
        <i className="l3" />
        <i className="l4" /> More
      </div>

      {shown && shownDay && (
        <>
          <div className="hd">
            {shown === today ? 'Today' : longDay(shown)} <span>{score(shownDay)}</span>
          </div>
          <p className="act-day">{breakdown(shownDay)}</p>
        </>
      )}

      <div className="hd">{year}</div>
      <div className="st">
        {(
          [
            [stats.logins, 'unlocks'],
            [stats.done, 'to-dos done'],
            [stats.added, 'things planned'],
            [fmtDur(stats.minutes * 60e3), 'tracked'],
            [stats.notes, 'notes'],
            [stats.chats, 'planner messages'],
            [stats.alarms, 'alarms'],
            [stats.longestStreak, 'longest streak'],
          ] as [number | string, string][]
        ).map(([v, l]) => (
          <div key={l} className="stt">
            <b>{days ? v : '–'}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityFooter() {
  const year = useDesk((s) => s.actYear);
  const act = useDesk((s) => s.act);
  const days = act && act.year === year ? act.days : {};
  const s = yearStats(year, days);
  return (
    <>
      <span>
        {s.currentStreak}-day streak · {s.activeDays} active day{s.activeDays === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        onClick={() =>
          void ask(
            `My desk activity for ${year}: ${s.activeDays} active days, current streak ${s.currentStreak} days (longest ${s.longestStreak}), ` +
              `${s.done} to-dos done, ${s.added} things planned, ${fmtDur(s.minutes * 60e3)} tracked, ${s.notes} notes. How am I doing, and what should I change?`,
          )
        }
      >
        Review my year →
      </button>
    </>
  );
}
