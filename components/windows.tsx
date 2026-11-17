'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closeWin,
  deleteItem,
  editItem,
  newItem,
  openWin,
  patchSettings,
  saveItem,
} from '@/lib/client/actions';
import { ask, clearChat } from '@/lib/client/chat';
import { flushDebounced } from '@/lib/client/debounce';
import { useNow } from '@/lib/client/hooks';
import { md } from '@/lib/client/markdown';
import { byTime, onDay, overdue, tasks } from '@/lib/client/selectors';
import { snd } from '@/lib/client/sound';
import { S, pname, setDesk, useDesk, type TodoFilter, type WinKey } from '@/lib/client/store';
import { DOW, MON, TODAY, addD, fmtD, iso, pad, parse } from '@/lib/shared/dates';
import type { Item, ItemType, ProjectKey } from '@/lib/shared/types';
import { AutoNote } from './AutoNote';
import { Notebook, NotebookFooter } from './Notebook';
import { QuickAdd } from './QuickAdd';
import { Row } from './Row';
import { TimerFooter, TimerWin } from './TimerWin';

export { useNow };

const useItems = () => {
  const items = useDesk((s) => s.items);
  return useMemo(() => Object.values(items), [items]);
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- today.md

export function Today() {
  useNow();
  const all = useItems();
  const now = new Date();
  const h = now.getHours();
  const t = TODAY();
  const list = onDay(all, t);
  const od = overdue(all, t).sort(byTime);
  const greet = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const mts = list.filter((x) => x.type === 'meeting');
  const evs = list.filter((x) => x.type === 'event').length;
  const open = list.filter((x) => x.type === 'task' && !x.done).length + od.length;
  const nowHM = pad(h) + ':' + pad(now.getMinutes());
  const nx = list.find((x) => x.time && x.type !== 'task' && x.time >= nowHM);

  return (
    <>
      <p className="sub">Planner · Dubai</p>
      <div className="hello">
        <div className="av" aria-hidden="true">
          S
        </div>
        <div>
          <b>{greet}, Sol</b>
          <span>
            {DOW[now.getDay()]} {now.getDate()} {MON[now.getMonth()]}
          </span>
        </div>
      </div>
      <p className="lede">
        {list.length || od.length ? (
          <>
            {plural(open, 'to-do')}, {plural(mts.length, 'meeting')} and {plural(evs, 'event')} today.
            {nx && (
              <>
                {' '}
                Next: <b>{nx.title}</b> at {nx.time}.
              </>
            )}
            {od.length ? ` ${od.length} carried over from before.` : ''}
          </>
        ) : (
          'Nothing planned yet. Type what’s on your mind below — “call Ali tomorrow 3pm #1”.'
        )}
      </p>
      <QuickAdd placeholder="Add anything… “gym 7am”, “sync with Sara fri 2pm #2”" label="Quick add" />
      {od.length > 0 && (
        <>
          <div className="hd">Carried over</div>
          {od.map((x) => (
            <Row key={x.id} x={x} showDate noTime />
          ))}
        </>
      )}
      <div className="hd">
        Today{' '}
        <button
          type="button"
          onClick={() => {
            newItem('task', t);
            snd('click');
          }}
        >
          + new
        </button>
      </div>
      {list.length ? list.map((x) => <Row key={x.id} x={x} />) : <p className="empty">A clear day.</p>}
    </>
  );
}

export function SaveStatusText() {
  const st = useDesk((s) => s.saveStatus);
  const text = st === 'error' ? 'Not saved' : st === 'saving' ? 'Saving…' : 'All changes saved';
  return (
    <span id="svs" role="status" aria-live="polite" className={`svs ${st === 'error' ? 'err' : ''}`} style={st === 'error' ? { color: 'var(--mt-ink)' } : undefined}>
      {text}
    </span>
  );
}

function AskLink({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => void ask(q)}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- calendar.app

export function Calendar() {
  const all = useItems();
  const calM = useDesk((s) => s.calM);
  const selDay = useDesk((s) => s.selDay);
  const first = parse(calM);
  const y = first.getFullYear();
  const m = first.getMonth();
  const start = addD(first, -((first.getDay() + 6) % 7));
  const t = TODAY();

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addD(start, i);
    const s = iso(d);
    const its = onDay(all, s);
    if (i >= 35 && d.getMonth() !== m) break;
    const rel = fmtD(s);
    // Starts with the visible number so the spoken name matches what's on screen.
    const label = `${d.getDate()} ${MON[d.getMonth()]}${/^(today|tomorrow|yesterday)$/.test(rel) ? ', ' + rel : ''}, ${plural(its.length, 'item')}`;
    cells.push(
      <button
        key={s}
        type="button"
        className={`dc ${d.getMonth() !== m ? 'out' : ''} ${s === t ? 'td' : ''} ${s === selDay ? 'sl' : ''}`}
        aria-label={label}
        aria-pressed={s === selDay}
        onClick={() => {
          setDesk({ selDay: s });
          snd('tick');
        }}
      >
        <span className="n">{d.getDate()}</span>
        {its.slice(0, 3).map((x) => (
          <i key={x.id} className={x.type === 'task' ? x.project || '' : x.type} />
        ))}
        {its.length > 3 && <em>+{its.length - 3}</em>}
      </button>,
    );
  }
  const go = (n: number) => {
    if (!n) {
      const now = new Date();
      setDesk({ calM: iso(new Date(now.getFullYear(), now.getMonth(), 1)), selDay: TODAY() });
    } else setDesk({ calM: iso(new Date(y, m + n, 1)) });
    snd('click');
  };
  const dl = onDay(all, selDay);
  const label = fmtD(selDay);
  return (
    <div className="split">
      <div>
        <div className="calh">
          <b>
            {MON[m]} {y}
          </b>
          <button type="button" className="btn gh" aria-label="Previous month" onClick={() => go(-1)}>
            ‹
          </button>
          <button type="button" className="btn gh" onClick={() => go(0)}>
            Today
          </button>
          <button type="button" className="btn gh" aria-label="Next month" onClick={() => go(1)}>
            ›
          </button>
        </div>
        <div className="calg">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} className="dow" aria-hidden="true">
              {d}
            </div>
          ))}
          {cells}
        </div>
      </div>
      <div>
        <div className="hd" style={{ marginTop: 6 }}>
          {label.charAt(0).toUpperCase() + label.slice(1)}
          <button
            type="button"
            onClick={() => {
              newItem('event', selDay);
              snd('click');
            }}
          >
            + add
          </button>
        </div>
        {dl.length ? dl.map((x) => <Row key={x.id} x={x} />) : <p className="empty">Nothing on this day.</p>}
        <div className="bar" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn gh"
            onClick={() => {
              newItem('meeting', selDay);
              snd('click');
            }}
          >
            + meeting
          </button>
          <button
            type="button"
            className="btn gh"
            onClick={() => {
              newItem('task', selDay);
              snd('click');
            }}
          >
            + to-do
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- meetings.txt

function MeetingCard({ x, past }: { x: Item; past: boolean }) {
  const settings = useDesk((s) => s.settings);
  const details = [x.with && 'with ' + x.with, x.dur && x.dur + ' min', x.link].filter(Boolean).join(' · ');
  return (
    <div className="mt">
      <div className="when">
        {x.time || '—'}
        <small>{fmtD(x.date)}</small>
      </div>
      <div>
        <h5 onClick={() => editItem(x.id)}>
          <button type="button">{x.title}</button>{' '}
          {x.project && <span className={`pj ${x.project}`}>{pname(settings, x.project)}</span>}
        </h5>
        <p>{details || 'No details yet'}</p>
        <AutoNote
          className="in"
          data-note={x.id}
          saveKey={'note.' + x.id}
          value={x.notes}
          placeholder={past ? 'What was decided? Next steps?' : 'Agenda, things to bring up…'}
          aria-label={`Notes for ${x.title}`}
          onSave={(v) => {
            const cur = S().items[x.id];
            if (cur && cur.notes !== v) saveItem({ ...cur, notes: v });
          }}
        />
      </div>
    </div>
  );
}

export function Meetings() {
  const all = useItems();
  const t = TODAY();
  const ms = all.filter((x) => x.type === 'meeting').sort(byTime);
  const up = ms.filter((x) => (x.date ?? '') >= t);
  const past = ms.filter((x) => (x.date ?? '') < t).reverse().slice(0, 12);
  return (
    <>
      <div className="bar">
        <button
          type="button"
          className="btn"
          onClick={() => {
            newItem('meeting');
            snd('click');
          }}
        >
          + New meeting
        </button>
      </div>
      <div className="hd">Coming up</div>
      {up.length ? up.map((x) => <MeetingCard key={x.id} x={x} past={false} />) : <p className="empty">No meetings booked.</p>}
      {past.length > 0 && (
        <>
          <div className="hd">Updates from past meetings</div>
          {past.map((x) => (
            <MeetingCard key={x.id} x={x} past />
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- to-do.md

const TODO_FILTERS: [TodoFilter, string][] = [
  ['open', 'All'],
  ['today', 'Today'],
  ['week', 'This week'],
  ['someday', 'Someday'],
  ['done', 'Done'],
];

export function Todo() {
  const all = useItems();
  const settings = useDesk((s) => s.settings);
  const todoF = useDesk((s) => s.todoF);
  const todoP = useDesk((s) => s.todoP);
  const t = TODAY();
  const wk = iso(addD(new Date(), 7));
  let l = tasks(all);
  if (todoP) l = l.filter((x) => x.project === todoP);
  const F: Record<TodoFilter, (x: Item) => boolean> = {
    open: (x) => !x.done,
    today: (x) => !x.done && !!x.date && x.date <= t,
    week: (x) => !x.done && !!x.date && x.date <= wk,
    someday: (x) => !x.done && !x.date,
    done: (x) => x.done,
  };
  l = l.filter(F[todoF]).sort(byTime);
  const projects: ['' | ProjectKey, string][] = [
    ['', 'Any'],
    ['p1', settings.p1.name],
    ['p2', settings.p2.name],
  ];
  return (
    <>
      <QuickAdd kind="task" placeholder="New to-do… add a day like “fri” or #1 / #2" label="New to-do" />
      <div className="bar">
        <div className="seg" role="group" aria-label="Show">
          {TODO_FILTERS.map(([k, v]) => (
            <button
              key={k}
              type="button"
              className={todoF === k ? 'on' : ''}
              aria-pressed={todoF === k}
              onClick={() => {
                setDesk({ todoF: k });
                snd('tick');
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Project">
          {projects.map(([k, v]) => (
            <button
              key={k || 'any'}
              type="button"
              className={todoP === k ? 'on' : ''}
              aria-pressed={todoP === k}
              onClick={() => {
                setDesk({ todoP: k });
                snd('tick');
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {l.length ? (
        l.map((x) => <Row key={x.id} x={x} showDate noTime />)
      ) : (
        <p className="empty">{todoF === 'done' ? 'Nothing finished yet.' : 'All clear here.'}</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- <project>/

function ProjectName({ p }: { p: ProjectKey }) {
  const name = useDesk((s) => s.settings[p].name);
  const [v, setV] = useState(name);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(name);
  }, [name]);
  const key = (p + 'Name') as 'p1Name' | 'p2Name';
  return (
    <input
      className="pname"
      data-pn={p}
      value={v}
      aria-label="Project name"
      title="Click to rename"
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setV(e.target.value);
        patchSettings({ [key]: e.target.value || 'untitled' }, true);
      }}
      onBlur={() => {
        focused.current = false;
        flushDebounced('settings.' + key);
        setV(S().settings[p].name);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Project({ p }: { p: ProjectKey }) {
  const all = useItems();
  const s = useDesk((st) => st.settings[p]);
  const t = TODAY();
  const l = all.filter((x) => x.project === p);
  const ts = tasks(l);
  const dn = ts.filter((x) => x.done).length;
  const pc = ts.length ? Math.round((dn / ts.length) * 100) : 0;
  const nextT = ts.filter((x) => !x.done).sort(byTime);
  const mts = l.filter((x) => x.type !== 'task' && (x.date ?? '') >= t).sort(byTime).slice(0, 5);
  const notesKey = (p + 'Notes') as 'p1Notes' | 'p2Notes';
  return (
    <>
      <ProjectName p={p} />
      <div className="meter" role="progressbar" aria-label={`${s.name} progress`} aria-valuenow={pc} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: pc + '%', background: `var(--${p})` }} />
      </div>
      <p className="sub">
        {dn} of {ts.length} to-dos done · {pc}%
      </p>
      <QuickAdd kind="task" project={p} placeholder={`Add to ${s.name}…`} label="Add to project" />
      <div className="hd">Next up</div>
      {nextT.length ? nextT.map((x) => <Row key={x.id} x={x} showDate noTime noProj />) : <p className="empty">No open to-dos.</p>}
      <div className="hd">Meetings &amp; events</div>
      {mts.length ? mts.map((x) => <Row key={x.id} x={x} showDate noProj />) : <p className="empty">Nothing booked.</p>}
      <div className="hd">Notes</div>
      <AutoNote
        className="in"
        data-pnote={p}
        saveKey={'pnote.' + p}
        value={s.notes}
        placeholder="Goals, links, where you left off…"
        aria-label="Project notes"
        onSave={(v) => patchSettings({ [notesKey]: v })}
      />
    </>
  );
}

// ---------------------------------------------------------------- future.md

export function Future() {
  const all = useItems();
  const now = new Date();
  const t = TODAY();
  const wkEnd = iso(addD(now, 6));
  const months: React.ReactNode[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const k = iso(d).slice(0, 7);
    const l = all
      .filter((x) => x.date && x.date.slice(0, 7) === k && x.date >= t && !x.done && (i > 0 || x.month || x.date > wkEnd))
      .sort(byTime);
    months.push(
      <div className="mo" key={k}>
        <b>
          {MON[d.getMonth()].slice(0, 3)}
          <small>{d.getFullYear()}</small>
        </b>
        <div>
          {l.map((x) => (
            <Row key={x.id} x={x} showDate={!x.month} noTime />
          ))}
          <button
            type="button"
            className="add"
            onClick={() => {
              newItem('task', k + '-01', { month: true });
              snd('click');
            }}
          >
            + plan something for {MON[d.getMonth()]}
          </button>
        </div>
      </div>,
    );
  }
  const sd = tasks(all).filter((x) => !x.date && !x.done);
  return (
    <>
      <p className="lede" style={{ fontSize: 14, color: 'var(--mut)' }}>
        The next twelve months. Goals without a date sit in Someday.
      </p>
      {months}
      <div className="mo">
        <b>Someday</b>
        <div>
          {sd.map((x) => (
            <Row key={x.id} x={x} noTime />
          ))}
          <button
            type="button"
            className="add"
            onClick={() => {
              newItem('task', null);
              snd('click');
            }}
          >
            + add an idea
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- planner.chat

export const CHIPS = ['Plan my day', 'Plan my week', 'What am I forgetting?', 'Split my time between projects', 'Make me a morning routine'];

function Typing() {
  return (
    <span className="typing" aria-label="Planner is typing">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Chat() {
  const chat = useDesk((s) => s.chat);
  const live = useDesk((s) => s.live);
  const busy = useDesk((s) => s.chatBusy);
  const msgs = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const m = msgs.current;
    if (m) m.scrollTop = m.scrollHeight;
  }, [chat, live]);

  const has = chat.length > 0 || !!live;
  return (
    <div className="chat">
      <div className="msgs" id="msgs" aria-live="polite">
        {!has && (
          <div className="msg b">
            <p>
              Hi Sol. I can see your calendar, meetings and to-dos. Ask me to plan your day or week, split time between your two projects, or turn a messy list
              into a schedule — I can add things to your calendar for you.
            </p>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.role === 'user' ? 'u' : 'b'}`}>
            {m.role === 'user' ? m.content : <span dangerouslySetInnerHTML={{ __html: md(m.content) }} />}
            {m.addedCount > 0 && <span className="added">✓ Added {m.addedCount} to your calendar</span>}
          </div>
        ))}
        {live && (
          <>
            <div className="msg u">{live.q}</div>
            <div className="msg b">
              {live.error ? (
                <p>{live.error}</p>
              ) : live.text ? (
                <span dangerouslySetInnerHTML={{ __html: md(live.text) }} />
              ) : (
                <Typing />
              )}
              {!!live.added && <span className="added">✓ Added {live.added} to your calendar</span>}
            </div>
          </>
        )}
      </div>
      <div className="chips">
        {CHIPS.map((q) => (
          <button key={q} type="button" onClick={() => void ask(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="cin"
        onSubmit={(e) => {
          e.preventDefault();
          const v = input.current?.value.trim();
          if (v && !busy && input.current) {
            input.current.value = '';
            void ask(v);
          }
        }}
      >
        <input ref={input} className="in" name="q" placeholder="Ask your planner…" autoComplete="off" aria-label="Message the planner" />
        <button className="btn" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- new.md / edit.md

const TYPES: [ItemType, string][] = [
  ['task', 'To-do'],
  ['event', 'Event'],
  ['meeting', 'Meeting'],
];

export function ItemForm() {
  const editing = useDesk((s) => s.editing);
  const exists = useDesk((s) => !!(s.editing && s.items[s.editing.id]));
  const settings = useDesk((s) => s.settings);
  const [x, setX] = useState<Item | null>(editing);
  if (!x) return null;
  const ty = x.type;
  const up = (p: Partial<Item>) => setX((cur) => (cur ? { ...cur, ...p } : cur));
  const pOpts = (
    <>
      <option value="">No project</option>
      <option value="p1">{settings.p1.name}</option>
      <option value="p2">{settings.p2.name}</option>
    </>
  );
  const projectField = (
    <label>
      Project
      <select className="in" name="project" value={x.project ?? ''} onChange={(e) => up({ project: (e.target.value || null) as ProjectKey | null })}>
        {pOpts}
      </select>
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const title = x.title.trim();
        if (!title) return;
        const it: Item = { ...x, title };
        if (it.type === 'task') it.time = null;
        else it.month = false;
        saveItem(it);
        closeWin('form', true);
        snd('key');
      }}
    >
      <div className="bar">
        <div className="seg" role="group" aria-label="Type">
          {TYPES.map(([k, v]) => (
            <button
              key={k}
              type="button"
              className={ty === k ? 'on' : ''}
              aria-pressed={ty === k}
              onClick={() => {
                // A new event/meeting gets today's date, like one started from "New event"/"New meeting".
                up(!exists && k !== 'task' && !x.date ? { type: k, date: TODAY() } : { type: k });
                snd('tick');
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="fg">
        <label className="w">
          Title
          <input className="in" name="title" value={x.title} required onChange={(e) => up({ title: e.target.value })} />
        </label>
        <label>
          Date
          <input className="in" type="date" name="date" value={x.date || ''} onChange={(e) => up({ date: e.target.value || null })} />
        </label>
        {ty === 'task' ? (
          projectField
        ) : (
          <label>
            Time
            <input className="in" type="time" name="time" value={x.time || ''} onChange={(e) => up({ time: e.target.value || null })} />
          </label>
        )}
        {ty !== 'task' && (
          <>
            <label>
              Minutes
              <input
                className="in"
                type="number"
                min={0}
                step={5}
                name="dur"
                value={x.dur || ''}
                onChange={(e) => up({ dur: Math.max(0, Math.round(+e.target.value || 0)) })}
              />
            </label>
            {projectField}
          </>
        )}
        {ty === 'meeting' && (
          <>
            <label>
              With
              <input className="in" name="with" value={x.with} placeholder="People" onChange={(e) => up({ with: e.target.value })} />
            </label>
            <label>
              Link or place
              <input className="in" name="link" value={x.link} onChange={(e) => up({ link: e.target.value })} />
            </label>
          </>
        )}
        {ty === 'task' && (
          <label className="chk w">
            <input type="checkbox" name="month" checked={x.month} onChange={(e) => up({ month: e.target.checked })} /> Any time that month (no fixed day)
          </label>
        )}
        <label className="w">
          Notes
          <textarea className="in" name="notes" value={x.notes} onChange={(e) => up({ notes: e.target.value })} />
        </label>
      </div>
      <div className="fa">
        {exists ? (
          <button
            type="button"
            className="btn gh"
            onClick={() => {
              closeWin('form', true);
              deleteItem(x.id);
              snd('del');
            }}
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn gh" onClick={() => closeWin('form')}>
            Cancel
          </button>
          <button className="btn">Save</button>
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- dispatch

export function WindowBody({ k }: { k: WinKey }) {
  switch (k) {
    case 'today':
      return <Today />;
    case 'calendar':
      return <Calendar />;
    case 'meetings':
      return <Meetings />;
    case 'todo':
      return <Todo />;
    case 'p1':
    case 'p2':
      return <Project p={k} />;
    case 'future':
      return <Future />;
    case 'chat':
      return <Chat />;
    case 'form':
      return <ItemForm />;
    case 'timer':
      return <TimerWin />;
    case 'notes':
      return <Notebook />;
  }
}

export function WindowFooter({ k }: { k: WinKey }) {
  const items = useDesk((s) => s.items);
  const calM = useDesk((s) => s.calM);
  const settings = useDesk((s) => s.settings);
  const all = Object.values(items);
  switch (k) {
    case 'today':
      return (
        <>
          <SaveStatusText />
          <AskLink q="Plan my day">Plan my day →</AskLink>
        </>
      );
    case 'calendar': {
      const n = all.filter((x) => x.date && x.date.slice(0, 7) === calM.slice(0, 7)).length;
      return (
        <>
          <span>{plural(n, 'object')} this month</span>
          <button
            type="button"
            onClick={() => {
              openWin('future');
              snd('click');
            }}
          >
            Further ahead →
          </button>
        </>
      );
    }
    case 'meetings': {
      const n = all.filter((x) => x.type === 'meeting' && (x.date ?? '') >= TODAY()).length;
      return (
        <>
          <span>{n} upcoming</span>
          <AskLink q="Help me prepare for my next meetings">Prep me →</AskLink>
        </>
      );
    }
    case 'todo': {
      const ts = tasks(all);
      return (
        <>
          <span>
            {ts.filter((x) => !x.done).length} open · {ts.filter((x) => x.done).length} done
          </span>
          <AskLink q="Look at my to-dos and tell me what to do first">Prioritise →</AskLink>
        </>
      );
    }
    case 'p1':
    case 'p2':
      return (
        <>
          <span>{plural(all.filter((x) => x.project === k).length, 'object')}</span>
          <AskLink q={`Make a plan for ${settings[k].name} for the next two weeks`}>Plan this →</AskLink>
        </>
      );
    case 'future':
      return (
        <>
          <span>Look ahead</span>
          <AskLink q="Help me plan my next three months">Plan 3 months →</AskLink>
        </>
      );
    case 'chat':
      return (
        <>
          <span>Planner · ideas, not orders</span>
          <button type="button" onClick={() => void clearChat()}>
            Clear chat
          </button>
        </>
      );
    case 'timer':
      return <TimerFooter />;
    case 'notes':
      return <NotebookFooter />;
    default:
      return null;
  }
}

export const hasFooter = (k: WinKey) => k !== 'form';
