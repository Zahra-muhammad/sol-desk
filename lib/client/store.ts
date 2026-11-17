import { create } from 'zustand';
import { TODAY, iso } from '@/lib/shared/dates';
import { DEFAULT_SETTINGS, type ChatMessage, type Item, type ProjectKey, type SavedWinKey, type Settings } from '@/lib/shared/types';
import type { SaveStatus } from './sync';

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

  menu: string | null;
  startOpen: boolean;
  toast: { msg: string; undo: boolean; n: number } | null;
  lastDeleted: Item[] | null;

  locked: boolean;
  lockMode: LockMode;
  saveStatus: SaveStatus;
}

const now = new Date();

export const initialDesk = (): DeskStore => ({
  ready: false,
  items: {},
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
  menu: null,
  startOpen: false,
  toast: null,
  lastDeleted: null,
  locked: true,
  lockMode: 'loading',
  saveStatus: 'saved',
});

export const useDesk = create<DeskStore>(initialDesk);
export const S = () => useDesk.getState();
export const setDesk = useDesk.setState;

export const pname = (s: Settings, p: ProjectKey | null | undefined) => (p === 'p1' ? s.p1.name : p === 'p2' ? s.p2.name : '');
