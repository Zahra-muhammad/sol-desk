'use client';

import { TODAY, fmtD, iso } from '@/lib/shared/dates';
import { uid } from '@/lib/shared/ids';
import {
  WINDOW_KEYS,
  type DeskState,
  type Item,
  type ItemType,
  type Alarm,
  type Note,
  type ProjectKey,
  type Settings,
  type SettingsPatch,
  type Theme,
  type TimeEntry,
  type WinLayout,
} from '@/lib/shared/types';
import { running } from '@/lib/shared/time';
import { api, post } from './api';
import { debounced, flushAllDebounced } from './debounce';
import { idbOutbox } from './idb';
import { tasks } from './selectors';
import { setSoundEnabled, snd } from './sound';
import { S, setDesk, type Geo, type LockMode, type WinKey } from './store';
import { SyncEngine, mergeById, type Collection, type Pending } from './sync';

// ---------------------------------------------------------------- windows

export interface WinDef {
  n: string;
  icon: 'file' | 'dir' | 'app';
  w: number;
  h: number | 'auto';
  flush?: boolean;
}

// Compact defaults so more of the desk shows. Bump LAYOUT_VERSION when these change to shrink saved windows once.
export const W: Record<WinKey, WinDef> = {
  today: { n: 'today.md', icon: 'file', w: 310, h: 410 },
  calendar: { n: 'calendar.app', icon: 'app', w: 540, h: 440 },
  meetings: { n: 'meetings.txt', icon: 'file', w: 360, h: 440 },
  todo: { n: 'to-do.md', icon: 'file', w: 370, h: 430 },
  p1: { n: 'p1', icon: 'dir', w: 340, h: 440 },
  p2: { n: 'p2', icon: 'dir', w: 340, h: 440 },
  future: { n: 'future.md', icon: 'file', w: 370, h: 450 },
  chat: { n: 'planner.chat', icon: 'app', w: 340, h: 460, flush: true },
  timer: { n: 'timer.app', icon: 'app', w: 320, h: 460 },
  notes: { n: 'notebook.md', icon: 'file', w: 520, h: 440, flush: true },
  alarms: { n: 'alarms.app', icon: 'app', w: 320, h: 420 },
  activity: { n: 'activity.app', icon: 'app', w: 800, h: 480 },
  feed: { n: 'feed.app', icon: 'app', w: 660, h: 470, flush: true },
  form: { n: 'new.md', icon: 'file', w: 380, h: 'auto' },
};
export const LAYOUT_VERSION = '2';

export const ICONS: [WinKey, string][] = [
  ['today', 'today'],
  ['calendar', 'calendar'],
  ['meetings', 'meetings'],
  ['todo', 'to-do'],
  ['p1', ''],
  ['p2', ''],
  ['future', 'future'],
  ['chat', 'planner'],
  ['timer', 'timer'],
  ['notes', 'notebook'],
  ['alarms', 'alarms'],
  ['activity', 'activity'],
  ['feed', 'feed'],
];

export const iconLabel = (k: WinKey, s: Settings) => (k === 'p1' ? s.p1.name : k === 'p2' ? s.p2.name : ICONS.find((x) => x[0] === k)?.[1] ?? k);

/** Title-bar / taskbar name. */
export function wname(k: WinKey, s: Settings, items?: Record<string, Item>, editing?: Item | null): string {
  if (k === 'p1') return s.p1.name;
  if (k === 'p2') return s.p2.name;
  if (k === 'form') return editing && items && items[editing.id] ? 'edit.md' : 'new.md';
  return W[k].n;
}

let deskEl: HTMLElement | null = null;
export const setDeskEl = (el: HTMLElement | null) => {
  deskEl = el;
};
export const isPhone = () => typeof window !== 'undefined' && window.innerWidth <= 760;

export function defaultPos(k: WinKey): Geo {
  const dw = deskEl?.clientWidth ?? 1200;
  const dh = deskEl?.clientHeight ?? 800;
  const w = W[k].w;
  const P: Record<WinKey, [number, number]> = {
    today: [16, 16],
    calendar: [Math.max(16, dw - 160 - w - 30), 40],
    meetings: [390, 60],
    todo: [16, 330],
    p1: [420, 90],
    p2: [460, 120],
    future: [500, 50],
    chat: [Math.max(16, dw - 160 - 400), 70],
    timer: [Math.max(16, dw - 160 - 380 - 40), 100],
    notes: [Math.max(16, dw / 2 - 300), 60],
    alarms: [Math.max(16, dw - 160 - 380 - 70), 130],
    activity: [Math.max(16, (dw - 160) / 2 - 410), 70],
    feed: [Math.max(16, (dw - 160) / 2 - 380), 50],
    form: [Math.max(16, dw / 2 - 210), 80],
  };
  const [x, y] = P[k];
  return {
    x: Math.min(x, Math.max(8, dw - w - 8)),
    y: Math.min(y, Math.max(8, dh - 200)),
    w,
    // Never taller than 80% of the desk.
    h: W[k].h === 'auto' ? null : Math.min(W[k].h as number, Math.round(dh * 0.8)),
  };
}

export function openWin(k: WinKey, opts: { silent?: boolean } = {}) {
  const s = S();
  if (s.open.includes(k)) {
    focusWin(k);
    return;
  }
  const saved = k === 'form' ? undefined : s.geo[k];
  const g: Geo = { ...defaultPos(k), ...(saved || {}) };
  if (saved && saved.h == null && W[k].h !== 'auto') g.h = defaultPos(k).h;
  setDesk({
    open: [...s.open, k],
    stack: [...s.stack.filter((x) => x !== k), k],
    geo: { ...s.geo, [k]: g },
  });
  if (!opts.silent) snd('open');
  persistLayout();
}

export function closeWin(k: WinKey, noRestore = false) {
  const s = S();
  if (!s.open.includes(k)) return;
  snd('close');
  const patch: Partial<typeof s> = {
    open: s.open.filter((x) => x !== k),
    stack: s.stack.filter((x) => x !== k),
    maxed: s.maxed.filter((x) => x !== k),
  };
  if (k !== 'form' && !noRestore) {
    patch.closed = [...s.closed, k];
    patch.restoreN = s.restoreN + 1;
  }
  if (k === 'form') patch.editing = null;
  setDesk(patch);
  persistLayout();
}

export function focusWin(k: WinKey) {
  const s = S();
  if (s.stack[s.stack.length - 1] === k) return;
  setDesk({ stack: [...s.stack.filter((x) => x !== k), k] });
  persistLayout();
}

export const topWin = () => {
  const st = S().stack;
  return st[st.length - 1];
};

export function toggleMax(k: WinKey) {
  const s = S();
  setDesk({ maxed: s.maxed.includes(k) ? s.maxed.filter((x) => x !== k) : [...s.maxed, k] });
  snd('click');
}

export function unmaxAll() {
  setDesk({ maxed: [] });
  snd('click');
}

export function showDesktop() {
  const s = S();
  const closing = s.open.filter((k) => k !== 'form');
  setDesk({
    open: [],
    stack: [],
    maxed: [],
    editing: null,
    closed: [...s.closed, ...closing],
    restoreN: closing.length ? s.restoreN + 1 : s.restoreN,
  });
  snd('close');
  persistLayout();
}

export function restoreWin() {
  const s = S();
  const k = s.closed[s.closed.length - 1];
  if (!k) return;
  setDesk({ closed: s.closed.slice(0, -1), restoreN: s.closed.length > 1 ? s.restoreN + 1 : s.restoreN });
  openWin(k);
}

export function setGeo(k: WinKey, g: Geo) {
  setDesk({ geo: { ...S().geo, [k]: g } });
  if (k !== 'form') persistLayout();
}

const lastLayout: Record<string, string> = {};
function persistLayout() {
  if (!S().ready) return;
  debounced(
    'layout',
    () => {
      const s = S();
      const out: WinLayout[] = [];
      for (const k of WINDOW_KEYS) {
        const g = s.geo[k];
        if (!g) continue;
        const z = s.stack.indexOf(k);
        const l: WinLayout = {
          key: k,
          x: Math.round(g.x),
          y: Math.round(g.y),
          w: Math.round(g.w),
          h: g.h == null ? null : Math.round(g.h),
          open: s.open.includes(k),
          z: z < 0 ? 0 : z,
        };
        const j = JSON.stringify(l);
        if (lastLayout[k] !== j) {
          lastLayout[k] = j;
          out.push(l);
        }
      }
      if (out.length) engine?.queueLayout(out);
    },
    800,
  );
}

// ---------------------------------------------------------------- toast

export function toast(msg: string, undo = false) {
  const n = (S().toast?.n ?? 0) + 1;
  setDesk({ toast: { msg, undo, n } });
}

// ---------------------------------------------------------------- items

/** A timestamp guaranteed to be newer than `prev` (two edits in one millisecond still order correctly). */
function stamp(prev?: string | null): string {
  let t = Date.now();
  if (prev) {
    const p = Date.parse(prev);
    if (!Number.isNaN(p) && p >= t) t = p + 1;
  }
  return new Date(t).toISOString();
}

export function saveItem(it: Item) {
  const prev = S().items[it.id];
  const next: Item = { ...it, deletedAt: null, updatedAt: stamp(prev?.updatedAt ?? it.updatedAt) };
  setDesk((s) => ({ items: { ...s.items, [it.id]: next } }));
  engine?.queueItem(next);
  return next;
}

export function toggleDone(id: string) {
  const x = S().items[id];
  if (!x) return;
  snd(x.done ? 'unkey' : 'key');
  saveItem({ ...x, done: !x.done, doneAt: !x.done ? new Date().toISOString() : null });
}

export function deleteItem(id: string, silent = false) {
  const it = S().items[id];
  if (!it) return;
  const t = stamp(it.updatedAt);
  const tomb: Item = { ...it, deletedAt: t, updatedAt: t };
  setDesk((s) => {
    const items = { ...s.items };
    delete items[id];
    return silent ? { items } : { items, lastDeleted: { kind: 'items' as const, recs: [it] } };
  });
  engine?.queueItem(tomb);
  if (!silent) toast('Deleted “' + it.title + '”', true);
}

/** Undo the last delete — items, tracked time, notes or alarms. */
export function undoDelete() {
  const l = S().lastDeleted;
  if (!l) return;
  if (l.kind === 'items') (l.recs as Item[]).forEach((x) => saveItem({ ...x, deletedAt: null }));
  if (l.kind === 'entries') (l.recs as TimeEntry[]).forEach((x) => saveRec('entries', { ...x, deletedAt: null }));
  if (l.kind === 'alarms') (l.recs as Alarm[]).forEach((x) => saveRec('alarms', { ...x, deletedAt: null }));
  if (l.kind === 'notes') {
    (l.recs as Note[]).forEach((x) => saveRec('notes', { ...x, deletedAt: null }));
    setDesk({ noteSel: l.recs[0]?.id ?? null });
  }
  setDesk({ lastDeleted: null });
  toast('Restored');
  snd('click');
}

export function clearDone() {
  const dn = tasks(Object.values(S().items)).filter((x) => x.done);
  if (!dn.length) {
    toast('No finished to-dos');
    return;
  }
  dn.forEach((x) => deleteItem(x.id, true));
  setDesk({ lastDeleted: { kind: 'items', recs: dn } });
  toast(`Cleared ${dn.length} finished to-do${dn.length > 1 ? 's' : ''}`, true);
  snd('del');
}

export function blankItem(type: ItemType, date?: string | null, extra: Partial<Item> = {}): Item {
  const t = new Date().toISOString();
  return {
    id: uid(),
    type,
    title: '',
    date: date === undefined ? (type === 'task' ? null : TODAY()) : date || null,
    time: null,
    dur: type === 'meeting' ? 30 : type === 'event' ? 60 : 0,
    project: null,
    done: false,
    doneAt: null,
    month: false,
    with: '',
    link: '',
    notes: '',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    ...extra,
  };
}

function showForm(it: Item) {
  const s = S();
  setDesk({
    editing: it,
    formN: s.formN + 1,
    open: s.open.filter((k) => k !== 'form'),
    stack: s.stack.filter((k) => k !== 'form'),
  });
  openWin('form');
  setTimeout(() => (document.querySelector('#w-form [name=title]') as HTMLInputElement | null)?.focus(), 30);
}

export function newItem(type: ItemType, date?: string | null, extra: Partial<Item> = {}) {
  showForm(blankItem(type, date, extra));
}

export function editItem(id: string) {
  const x = S().items[id];
  if (!x) return;
  showForm(structuredClone(x));
  snd('click');
}

export function addQuick(it: Item) {
  saveItem(it);
  snd('key');
  toast(`Added “${it.title}”${it.date ? ' · ' + fmtD(it.date) : ''}${it.time ? ' ' + it.time : ''}`);
}

// ---------------------------------------------------------------- time entries & notes (shared)

type RecKind = 'entries' | 'notes' | 'alarms';
type Rec<C extends RecKind> = C extends 'entries' ? TimeEntry : C extends 'notes' ? Note : Alarm;

/** Save a time entry or note: on screen now, queued for the server. */
export function saveRec<C extends RecKind>(c: C, rec: Rec<C>): Rec<C> {
  const prev = (S()[c] as Record<string, Rec<C>>)[rec.id];
  const next = { ...rec, deletedAt: null, updatedAt: stamp(prev?.updatedAt ?? rec.updatedAt) } as Rec<C>;
  setDesk((s) => ({ [c]: { ...(s[c] as Record<string, Rec<C>>), [rec.id]: next } }) as never);
  engine?.queue(c, next as never);
  return next;
}

/** Soft delete with Undo. */
function deleteRec<C extends RecKind>(c: C, id: string, label: string) {
  const rec = (S()[c] as Record<string, Rec<C>>)[id];
  if (!rec) return;
  const t = stamp(rec.updatedAt);
  setDesk((s) => {
    const map = { ...(s[c] as Record<string, Rec<C>>) };
    delete map[id];
    return { [c]: map, lastDeleted: { kind: c as Collection, recs: [rec] } } as never;
  });
  engine?.queue(c, { ...rec, deletedAt: t, updatedAt: t } as never);
  toast(label, true);
  snd('del');
}

// ---------------------------------------------------------------- timer.app

/** Start tracking. Stops whatever was running first — one timer at a time. */
export function startTimer(label: string, project: ProjectKey | null) {
  const now = new Date().toISOString();
  stopTimer(true);
  saveRec('entries', { id: uid(), label: label.trim(), project, startedAt: now, endedAt: null, createdAt: now, updatedAt: now, deletedAt: null });
  setDesk({ timerLabel: label.trim(), timerProject: project ?? '' });
  snd('key');
}

/** Stop every running timer (normally there is only one). */
export function stopTimer(quiet = false) {
  const now = new Date().toISOString();
  const runningNow = Object.values(S().entries).filter((e) => !e.endedAt);
  runningNow.forEach((e) => saveRec('entries', { ...e, endedAt: now }));
  if (runningNow.length && !quiet) snd('click');
}

/** Rename / re-file the running timer while it runs. */
export function updateRunning(p: Partial<Pick<TimeEntry, 'label' | 'project'>>) {
  const r = running(Object.values(S().entries));
  if (r) saveRec('entries', { ...r, ...p });
}

/** Start a new timer with the same label and project as an earlier one. */
export function continueEntry(id: string) {
  const e = S().entries[id];
  if (e) startTimer(e.label, e.project);
}

export function deleteEntry(id: string) {
  const e = S().entries[id];
  if (e) deleteRec('entries', id, `Deleted “${e.label || 'untitled time'}”`);
}

// ---------------------------------------------------------------- notebook.md

export function newNote() {
  const now = new Date().toISOString();
  const n = saveRec('notes', { id: uid(), title: '', body: '', createdAt: now, updatedAt: now, deletedAt: null });
  setDesk({ noteSel: n.id, noteQ: '' });
  openWin('notes');
  snd('click');
  setTimeout(() => (document.querySelector('#w-notes .ntitle') as HTMLInputElement | null)?.focus(), 40);
}

/** Save something (e.g. a feed article) as a new notebook page. */
export function saveToNotebook(title: string, body: string) {
  const now = new Date().toISOString();
  saveRec('notes', { id: uid(), title: title.slice(0, 300), body, createdAt: now, updatedAt: now, deletedAt: null });
  toast(`Saved “${title.length > 40 ? title.slice(0, 39) + '…' : title}” to your notebook`);
  snd('key');
}

export function updateNote(id: string, p: Partial<Pick<Note, 'title' | 'body'>>) {
  const n = S().notes[id];
  if (!n) return;
  const changed = (p.title !== undefined && p.title !== n.title) || (p.body !== undefined && p.body !== n.body);
  if (changed) saveRec('notes', { ...n, ...p });
}

export function deleteNote(id: string) {
  const n = S().notes[id];
  if (!n) return;
  const rest = Object.values(S().notes)
    .filter((x) => x.id !== id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  deleteRec('notes', id, `Deleted “${n.title.trim() || 'Untitled note'}”`);
  setDesk({ noteSel: rest[0]?.id ?? null });
}

// ---------------------------------------------------------------- alarms.app

/** Ask once for permission to show system notifications when an alarm rings in a background tab. */
function askNotify() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* not supported */
  }
}

export function addAlarm(label: string, at: Date) {
  const now = new Date().toISOString();
  const a = saveRec('alarms', { id: uid(), label: label.trim(), at: at.toISOString(), dismissedAt: null, createdAt: now, updatedAt: now, deletedAt: null });
  askNotify();
  snd('key');
  return a;
}

export function dismissAlarm(id: string) {
  const a = S().alarms[id];
  if (a) saveRec('alarms', { ...a, dismissedAt: new Date().toISOString() });
  snd('click');
}

export function snoozeAlarm(id: string, ms = 5 * 60e3) {
  const a = S().alarms[id];
  if (a) saveRec('alarms', { ...a, at: new Date(Date.now() + ms).toISOString(), dismissedAt: null });
  snd('click');
}

export function deleteAlarm(id: string) {
  const a = S().alarms[id];
  if (a) deleteRec('alarms', id, `Deleted alarm${a.label ? ` “${a.label}”` : ''}`);
}

// ---------------------------------------------------------------- settings

const PATCH_TO: Record<keyof SettingsPatch, (s: Settings, v: never) => Settings> = {
  p1Name: (s, v) => ({ ...s, p1: { ...s.p1, name: v } }),
  p1Notes: (s, v) => ({ ...s, p1: { ...s.p1, notes: v } }),
  p2Name: (s, v) => ({ ...s, p2: { ...s.p2, name: v } }),
  p2Notes: (s, v) => ({ ...s, p2: { ...s.p2, notes: v } }),
  theme: (s, v) => ({ ...s, theme: v }),
  sound: (s, v) => ({ ...s, sound: v }),
};

export function applySettingsPatch(s: Settings, p: SettingsPatch): Settings {
  let out = s;
  for (const [k, v] of Object.entries(p)) {
    const f = PATCH_TO[k as keyof SettingsPatch];
    if (f && v !== undefined) out = f(out, v as never);
  }
  return out;
}

/** Update the screen now; send to the server now, or 700 ms after typing stops. */
export function patchSettings(p: SettingsPatch, debounce = false) {
  setDesk((s) => ({ settings: applySettingsPatch(s.settings, p) }));
  if (!debounce) {
    engine?.queueSettings(p);
    return;
  }
  for (const k of Object.keys(p) as (keyof SettingsPatch)[]) {
    debounced('settings.' + k, () => {
      const cur = S().settings;
      const v = k === 'p1Name' ? cur.p1.name : k === 'p1Notes' ? cur.p1.notes : k === 'p2Name' ? cur.p2.name : k === 'p2Notes' ? cur.p2.notes : (cur as never)[k];
      engine?.queueSettings({ [k]: v } as SettingsPatch);
    });
  }
}

export function applyTheme(t: Theme) {
  const r = document.documentElement;
  r.classList.toggle('lite', t === 'light');
  r.classList.toggle('dk', t === 'dark');
  // Mirrors the setting so the lock screen renders in the right theme before login.
  document.cookie = `sol_theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

export function toggleTheme() {
  const next: Theme = S().settings.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  patchSettings({ theme: next });
  snd('click');
}

export function applySound(on: boolean) {
  setSoundEnabled(on);
  try {
    localStorage.setItem('desk.sound', JSON.stringify(on));
  } catch {
    /* ignore */
  }
}

export function toggleSound() {
  const on = !S().settings.sound;
  applySound(on);
  patchSettings({ sound: on });
  snd('click');
}

// ---------------------------------------------------------------- lock

export function lockNow(mode: Extract<LockMode, 'enter' | 'change'> = 'enter') {
  setDesk({ locked: true, lockMode: mode, menu: null, startOpen: false });
  snd('close');
  if (mode === 'enter') {
    flushAllDebounced();
    engine?.flushOnUnload();
    if (engine) engine.paused = true;
    void post('/api/auth/lock');
  }
}

/** Called by the lock screen after the server accepted the password. */
export async function afterUnlock() {
  const s = S();
  setDesk({ locked: false });
  markActive(true);
  if (!s.ready) {
    const r = await api.state();
    if (r.ok) loadState(r.data, true);
    else setDesk({ locked: true, lockMode: 'offline' });
    return;
  }
  if (engine) {
    engine.paused = false;
    await engine.flush();
    await engine.pull();
  }
}

export function cancelChange() {
  setDesk({ locked: false });
}

// Idle auto-lock (30 min). The server enforces the same limit, so a refresh can't skip it.
const IDLE = 30 * 60e3;
let lastAct = Date.now();
let lastBeat = 0;
export function markActive(force = false) {
  lastAct = Date.now();
  const s = S();
  if (s.locked || !s.ready) return;
  if (force || lastAct - lastBeat > 60e3) {
    lastBeat = lastAct;
    void post('/api/auth/heartbeat').then((r) => {
      if (!r.ok && r.status === 401) onUnauthorized();
    });
  }
}
export function checkIdle() {
  const s = S();
  if (!s.locked && s.ready && Date.now() - lastAct > IDLE) lockNow('enter');
}

function onUnauthorized() {
  const s = S();
  if (s.locked) return;
  setDesk({ locked: true, lockMode: 'enter', menu: null, startOpen: false });
  if (engine) engine.paused = true;
}

// ---------------------------------------------------------------- sync

let engine: SyncEngine | null = null;
export const getEngine = () => engine;

function applyPending(settings: Settings, incoming: Settings, pending: Pending): Settings {
  const keep: SettingsPatch = {};
  const cur = settings;
  if (pending.settings.has('p1Name')) keep.p1Name = cur.p1.name;
  if (pending.settings.has('p1Notes')) keep.p1Notes = cur.p1.notes;
  if (pending.settings.has('p2Name')) keep.p2Name = cur.p2.name;
  if (pending.settings.has('p2Notes')) keep.p2Notes = cur.p2.notes;
  if (pending.settings.has('theme')) keep.theme = cur.theme;
  if (pending.settings.has('sound')) keep.sound = cur.sound;
  return applySettingsPatch(incoming, keep);
}

/** Don't overwrite a field that is being typed into right now. */
function typingKeys(): Set<string> {
  const a = document.activeElement as HTMLElement | null;
  const out = new Set<string>();
  if (!a) return out;
  if (a.dataset.pn) out.add(a.dataset.pn + 'Name');
  if (a.dataset.pnote) out.add(a.dataset.pnote + 'Notes');
  return out;
}

export function receiveSettings(incoming: Settings, pending: Pending = { items: new Set(), entries: new Set(), notes: new Set(), alarms: new Set(), settings: new Set() }) {
  const s = S();
  for (const k of typingKeys()) pending.settings.add(k);
  const next = applyPending(s.settings, incoming, pending);
  if (next.theme !== s.settings.theme) applyTheme(next.theme);
  if (next.sound !== s.settings.sound) applySound(next.sound);
  setDesk({ settings: next });
}

/** Merge server copies of items, time entries, notes and alarms (newest wins; local unsaved edits are kept). */
export function receiveRecords(r: { items?: Item[]; entries?: TimeEntry[]; notes?: Note[]; alarms?: Alarm[] }, pending?: Pending) {
  // Don't replace the note being typed in right now.
  const typingNote = (document.activeElement as HTMLElement | null)?.closest?.('#w-notes .ned') ? S().noteSel : null;
  const noteSkip = new Set(pending?.notes ?? []);
  if (typingNote) noteSkip.add(typingNote);
  setDesk((s) => ({
    items: mergeById(s.items, r.items, pending?.items),
    entries: mergeById(s.entries, r.entries, pending?.entries),
    notes: mergeById(s.notes, r.notes, noteSkip),
    alarms: mergeById(s.alarms, r.alarms, pending?.alarms),
  }));
}

export function startSync(cursor: string) {
  if (engine) {
    engine.cursor = cursor;
    return engine;
  }
  engine = new SyncEngine(
    {
      push: api.push,
      pull: api.pull,
      beacon: api.beacon,
      store: idbOutbox,
      onStatus: (saveStatus) => setDesk({ saveStatus }),
      onPushed: (res, pending) => {
        receiveRecords(res, pending);
        receiveSettings(res.settings, pending);
      },
      onPulled: (d, pending) => {
        receiveRecords(d, pending);
        if (d.settings) receiveSettings(d.settings, pending);
        if (d.chat && !S().chatBusy) setDesk({ chat: d.chat });
      },
      onUnauthorized,
    },
    cursor,
  );
  return engine;
}

/** Put server state on screen. `fresh` also restores the window layout. */
export function loadState(state: DeskState, fresh: boolean) {
  const e = startSync(state.cursor);
  e.paused = false;
  applyTheme(state.settings.theme);
  applySound(state.settings.sound);
  setDesk({
    ready: true,
    locked: false,
    items: Object.fromEntries(state.items.map((i) => [i.id, i])),
    entries: Object.fromEntries((state.entries ?? []).map((x) => [x.id, x])),
    notes: Object.fromEntries((state.notes ?? []).map((x) => [x.id, x])),
    alarms: Object.fromEntries((state.alarms ?? []).map((x) => [x.id, x])),
    settings: state.settings,
    chat: state.chat,
  });

  if (fresh && !S().open.length) {
    const geo: Partial<Record<WinKey, Geo>> = {};
    // Once per layout version (per device), shrink saved windows to the current compact defaults.
    let resetSizes = false;
    try {
      resetSizes = localStorage.getItem('desk.layoutv') !== LAYOUT_VERSION;
      localStorage.setItem('desk.layoutv', LAYOUT_VERSION);
    } catch {
      /* ignore */
    }
    for (const l of state.layout) {
      const d = W[l.key];
      geo[l.key] = resetSizes ? { x: l.x, y: l.y, w: d.w, h: d.h === 'auto' ? null : (d.h as number) } : { x: l.x, y: l.y, w: l.w, h: l.h };
      lastLayout[l.key] = JSON.stringify(l);
    }
    setDesk({ geo });
    const open = state.layout.filter((l) => l.open).sort((a, b) => a.z - b.z).map((l) => l.key);
    const first: WinKey[] = open.length ? open : isPhone() ? ['today'] : ['today', 'calendar'];
    first.forEach((k) => openWin(k, { silent: true }));
  }

  // Re-apply anything queued on this device that never reached the server.
  void e.restore().then((ob) => {
    receiveRecords({ items: Object.values(ob.items), entries: Object.values(ob.entries), notes: Object.values(ob.notes), alarms: Object.values(ob.alarms) });
    if (Object.keys(ob.settings).length) setDesk((s) => ({ settings: applySettingsPatch(s.settings, ob.settings) }));
    if (!e.isEmpty()) void e.flush();
  });
}

export function flushForUnload() {
  flushAllDebounced();
  engine?.flushOnUnload();
}

// ---------------------------------------------------------------- backup

export async function downloadBackup() {
  flushAllDebounced();
  await engine?.flush();
  try {
    const r = await fetch('/api/backup', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) return onUnauthorized();
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sol-desk-backup-${iso(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded');
  } catch {
    toast('Couldn’t download a backup — check your connection');
  }
}

export async function importBackup(file: File) {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('That file isn’t a desk backup');
    return;
  }
  const n = Array.isArray((data as { items?: unknown[] })?.items) ? (data as { items: unknown[] }).items.length : 0;
  if (!window.confirm(`Import ${n} item${n === 1 ? '' : 's'} from “${file.name}”? Items with the same id are replaced by the backup's copy. Nothing else is removed.`)) return;
  flushAllDebounced();
  await engine?.flush();
  const r = await post<{ items: number; entries?: number; notes?: number }>('/api/backup', data);
  if (!r.ok) {
    if (r.status === 401) return onUnauthorized();
    toast(r.status === 400 ? 'That file isn’t a desk backup' : 'Couldn’t import — check your connection');
    return;
  }
  const st = await api.state();
  if (st.ok) loadState(st.data, false);
  const extra = [r.data.entries && `${r.data.entries} time entr${r.data.entries === 1 ? 'y' : 'ies'}`, r.data.notes && `${r.data.notes} note${r.data.notes === 1 ? '' : 's'}`].filter(Boolean);
  toast(`Imported ${r.data.items} item${r.data.items === 1 ? '' : 's'}${extra.length ? ', ' + extra.join(', ') : ''}`);
  snd('key');
}
