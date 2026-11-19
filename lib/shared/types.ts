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
  /** What the planner did while answering, e.g. "Alarm set for 16:00 · Timer started". */
  actions: string;
  createdAt: string;
}

/** One block of tracked time. endedAt = null while the timer is running. Syncs like items. */
export interface TimeEntry {
  id: string;
  /** What you were working on. */
  label: string;
  project: ProjectKey | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** A notebook page. Syncs like items (newest edit wins, soft delete). */
export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** An alarm or countdown ("timer till 4pm", "25 min"). Rings at `at` until dismissed. Syncs like items. */
export interface Alarm {
  id: string;
  label: string;
  /** ISO timestamp it rings at. */
  at: string;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** One post in feed.app (the article body is fetched separately). */
export interface FeedItem {
  /** sha1(link), 16 hex chars. */
  id: string;
  /** The publication's RSS address, e.g. https://name.substack.com/feed */
  feed: string;
  sourceTitle: string;
  sourceImage: string;
  title: string;
  subtitle: string;
  author: string;
  date: string;
  image: string;
  link: string;
}

/** A post kept in feed.app's Saved tab. The cleaned article HTML is stored with it. */
export interface SavedArticle extends FeedItem {
  savedAt: string;
  /** Only sent when one article is asked for (and in backups). */
  html?: string;
}

export const WINDOW_KEYS = ['today', 'calendar', 'meetings', 'todo', 'p1', 'p2', 'future', 'chat', 'timer', 'notes', 'alarms', 'activity', 'feed'] as const;
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
  /** Time entries from the last 60 days, plus any running timer. */
  entries: TimeEntry[];
  notes: Note[];
  alarms: Alarm[];
  settings: Settings;
  chat: ChatMessage[];
  layout: WinLayout[];
  /** Server clock; pass back as `since` to get only what changed. */
  cursor: string;
}

export interface DeskDelta {
  /** Changed items, including soft-deleted ones (deletedAt set). */
  items: Item[];
  /** Changed time entries and notes, including soft-deleted ones. */
  entries: TimeEntry[];
  notes: Note[];
  alarms: Alarm[];
  settings: Settings | null;
  /** Full recent chat, only when it changed. */
  chat: ChatMessage[] | null;
  cursor: string;
}

export interface PushBody {
  items?: Item[];
  entries?: TimeEntry[];
  notes?: Note[];
  alarms?: Alarm[];
  settings?: SettingsPatch;
  layout?: WinLayout[];
}

export interface PushResult {
  /** The server's copy of every pushed item after newest-wins was applied. */
  items: Item[];
  entries: TimeEntry[];
  notes: Note[];
  alarms: Alarm[];
  settings: Settings;
}

export interface Backup {
  app: 'sol-desk';
  version: 1;
  exportedAt: string;
  items: Item[];
  entries: TimeEntry[];
  notes: Note[];
  alarms: Alarm[];
  settings: Omit<Settings, 'updatedAt'>;
  chat: ChatMessage[];
  layout: WinLayout[];
  /** Articles saved in feed.app, with their cleaned HTML. */
  saved?: SavedArticle[];
}

export const DEFAULT_SETTINGS: Settings = {
  p1: { name: 'project one', notes: '' },
  p2: { name: 'project two', notes: '' },
  theme: 'dark',
  sound: true,
  updatedAt: new Date(0).toISOString(),
};
