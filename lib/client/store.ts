import { create } from 'zustand';
import { TODAY, iso } from '@/lib/shared/dates';
import { DEFAULT_SETTINGS, type Alarm, type ChatMessage, type Item, type Note, type ProjectKey, type SavedWinKey, type Settings, type TimeEntry } from '@/lib/shared/types';
import type { YearActivity } from '@/lib/shared/activity';
import type { Collection, SaveStatus } from './sync';

export type WinKey = SavedWinKey | 'form';
export type TodoFilter = 'open' | 'today' | 'week' | 'someday' | 'done';
export type LockMode = 'loading' | 'offline' | 'set' | 'enter' | 'change';

export interface Geo {
  x: number;
  y: number;
  w: number;
  h: number | null;
}

/** The exchange currently streaming in planner.chat. */
export interface ChatLive {
  q: string;
  text: string;
  error?: string;
  added?: number;
}

export interface DeskStore {
  /** Data has been loaded from the server (never true before login). */
  ready: boolean;
  items: Record<string, Item>;
  /** Tracked time (timer.app). */
  entries: Record<string, TimeEntry>;
  /** Notebook pages (notebook.md). */
  notes: Record<string, Note>;
  /** Alarms & countdowns (alarms.app). */
  alarms: Record<string, Alarm>;
  settings: Settings;
  chat: ChatMessage[];
  live: ChatLive | null;
  chatBusy: boolean;

  /** Open windows in the order they were opened (taskbar order). */
  open: WinKey[];
  /** Open windows bottom → top. */
  stack: WinKey[];
  geo: Partial<Record<WinKey, Geo>>;
  maxed: WinKey[];
  closed: WinKey[];
  restoreN: number;
  editing: Item | null;
  formN: number;

  calM: string;
  selDay: string;
  todoF: TodoFilter;
  todoP: '' | ProjectKey;
  /** Notebook: open page and search text. */
  noteSel: string | null;
  noteQ: string;
  /** Timer: what the next timer is for. */
  timerLabel: string;
  timerProject: '' | ProjectKey;
  /** activity.app: the year being shown and its per-day counts (fetched, not synced). */
  actYear: number;
  act: { year: number; days: YearActivity } | null;
  /** feed.app: counts for the footer, and a counter the footer bumps to refresh. */
  feedN: { posts: number; sources: number };
  feedTick: number;

  menu: string | null;
  startOpen: boolean;
  toast: { msg: string; undo: boolean; n: number } | null;
  /** What Undo brings back: the last thing deleted (items, time entries or notes). */
  lastDeleted: { kind: Collection; recs: (Item | TimeEntry | Note | Alarm)[] } | null;

  locked: boolean;
  lockMode: LockMode;
  /** Development only: why the server couldn't load the desk. */
  lockDetail: string | null;
  saveStatus: SaveStatus;
}

const now = new Date();

export const initialDesk = (): DeskStore => ({
  ready: false,
  items: {},
  entries: {},
  notes: {},
  alarms: {},
  settings: DEFAULT_SETTINGS,
  chat: [],
  live: null,
  chatBusy: false,
  open: [],
  stack: [],
  geo: {},
  maxed: [],
  closed: [],
  restoreN: 0,
  editing: null,
  formN: 0,
  calM: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
  selDay: TODAY(),
  todoF: 'open',
  todoP: '',
  noteSel: null,
  noteQ: '',
  timerLabel: '',
  timerProject: '',
  actYear: new Date().getFullYear(),
  act: null,
  feedN: { posts: 0, sources: 0 },
  feedTick: 0,
  menu: null,
  startOpen: false,
  toast: null,
  lastDeleted: null,
  locked: true,
  lockMode: 'loading',
  lockDetail: null,
  saveStatus: 'saved',
});

export const useDesk = create<DeskStore>(initialDesk);
export const S = () => useDesk.getState();
export const setDesk = useDesk.setState;

export const pname = (s: Settings, p: ProjectKey | null | undefined) => (p === 'p1' ? s.p1.name : p === 'p2' ? s.p2.name : '');
