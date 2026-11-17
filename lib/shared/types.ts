export type ItemType = 'task' | 'event' | 'meeting';
export type ProjectKey = 'p1' | 'p2';

/** One to-do, event or meeting. Dates are local calendar days (YYYY-MM-DD). */
export interface Item {
  id: string;
  type: ItemType;
  title: string;
  /** YYYY-MM-DD, or null for "someday". */
  date: string | null;
  /** HH:MM (24h), or null. */
  time: string | null;
  /** Minutes. */
  dur: number;
  project: ProjectKey | null;
  done: boolean;
  /** ISO timestamp. */
  doneAt: string | null;
  /** "Any time that month" — a to-do anchored to the month of `date`, not the day. */
  month: boolean;
  with: string;
  link: string;
  notes: string;
  createdAt: string;
  /** ISO timestamp of the last edit. The newest one wins when two devices disagree. */
  updatedAt: string;
  /** ISO timestamp. Soft delete, so Undo can bring it back. */
  deletedAt: string | null;
}

export interface ProjectSettings {
  name: string;
  notes: string;
}

export type Theme = 'dark' | 'light';

export interface Settings {
  p1: ProjectSettings;
  p2: ProjectSettings;
  theme: Theme;
  sound: boolean;
  updatedAt: string;
}

/** Only the fields that changed. Sent to the server as-is. */
export interface SettingsPatch {
  p1Name?: string;
  p1Notes?: string;
  p2Name?: string;
  p2Notes?: string;
  theme?: Theme;
  sound?: boolean;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  addedCount: number;
  createdAt: string;
}

export const WINDOW_KEYS = ['today', 'calendar', 'meetings', 'todo', 'p1', 'p2', 'future', 'chat'] as const;
export type SavedWinKey = (typeof WINDOW_KEYS)[number];

export interface WinLayout {
  key: SavedWinKey;
  x: number;
  y: number;
  w: number;
  h: number | null;
  open: boolean;
  /** Stacking position among open windows (0 = bottom). */
  z: number;
}

/** Everything the desk needs on load. */
export interface DeskState {
  items: Item[];
  settings: Settings;
  chat: ChatMessage[];
  layout: WinLayout[];
  /** Server clock; pass back as `since` to get only what changed. */
  cursor: string;
}

export interface DeskDelta {
  /** Changed items, including soft-deleted ones (deletedAt set). */
  items: Item[];
  settings: Settings | null;
  /** Full recent chat, only when it changed. */
  chat: ChatMessage[] | null;
  cursor: string;
}

export interface PushBody {
  items?: Item[];
  settings?: SettingsPatch;
  layout?: WinLayout[];
}

export interface PushResult {
  /** The server's copy of every pushed item after newest-wins was applied. */
  items: Item[];
  settings: Settings;
}

export interface Backup {
  app: 'sol-desk';
  version: 1;
  exportedAt: string;
  items: Item[];
  settings: Omit<Settings, 'updatedAt'>;
  chat: ChatMessage[];
  layout: WinLayout[];
}

export const DEFAULT_SETTINGS: Settings = {
  p1: { name: 'project one', notes: '' },
  p2: { name: 'project two', notes: '' },
  theme: 'dark',
  sound: true,
  updatedAt: new Date(0).toISOString(),
};
