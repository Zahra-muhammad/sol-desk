import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** To-dos, events and meetings. Soft-deleted (deleted_at) so Undo works and deletes sync to other devices. */
export const items = pgTable(
  'items',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['task', 'event', 'meeting'] }).notNull(),
    title: text('title').notNull(),
    /** Null = someday. */
    date: date('date', { mode: 'string' }),
    /** HH:MM. */
    time: text('time'),
    dur: integer('dur').notNull().default(0),
    project: text('project', { enum: ['p1', 'p2'] }),
    done: boolean('done').notNull().default(false),
    doneAt: tz('done_at'),
    /** "Any time that month". */
    month: boolean('month').notNull().default(false),
    with: text('with').notNull().default(''),
    link: text('link').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: tz('created_at').notNull().defaultNow(),
    /** When the edit was made (client clock). Newest wins. */
    updatedAt: tz('updated_at').notNull().defaultNow(),
    deletedAt: tz('deleted_at'),
    /** When the server last wrote the row (server clock). Drives "what changed since" sync. */
    syncedAt: tz('synced_at').notNull().defaultNow(),
  },
  (t) => [
    index('items_synced_at_idx').on(t.syncedAt),
    index('items_date_idx').on(t.date),
    check('items_type_check', sql`${t.type} in ('task', 'event', 'meeting')`),
    check('items_project_check', sql`${t.project} is null or ${t.project} in ('p1', 'p2')`),
    check('items_time_check', sql`${t.time} is null or ${t.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

/** Tracked time. ended_at is null while the timer runs. Same newest-wins / soft-delete rules as items. */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull().default(''),
    project: text('project', { enum: ['p1', 'p2'] }),
    startedAt: tz('started_at').notNull(),
    endedAt: tz('ended_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    deletedAt: tz('deleted_at'),
    syncedAt: tz('synced_at').notNull().defaultNow(),
  },
  (t) => [
    index('time_entries_synced_at_idx').on(t.syncedAt),
    index('time_entries_started_at_idx').on(t.startedAt),
    check('time_entries_project_check', sql`${t.project} is null or ${t.project} in ('p1', 'p2')`),
  ],
);

/** Notebook pages. Same newest-wins / soft-delete rules as items. */
export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    deletedAt: tz('deleted_at'),
    syncedAt: tz('synced_at').notNull().defaultNow(),
  },
  (t) => [index('notes_synced_at_idx').on(t.syncedAt), index('notes_updated_at_idx').on(t.updatedAt)],
);

/** One row: project names and notes, theme, sound. */
export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    p1Name: text('p1_name').notNull().default('project one'),
    p1Notes: text('p1_notes').notNull().default(''),
    p2Name: text('p2_name').notNull().default('project two'),
    p2Notes: text('p2_notes').notNull().default(''),
    theme: text('theme', { enum: ['dark', 'light'] }).notNull().default('dark'),
    sound: boolean('sound').notNull().default(true),
    chatClearedAt: tz('chat_cleared_at'),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    syncedAt: tz('synced_at').notNull().defaultNow(),
  },
  (t) => [check('settings_singleton', sql`${t.id} = 1`)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    addedCount: integer('added_count').notNull().default(0),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('chat_messages_created_at_idx').on(t.createdAt), check('chat_role_check', sql`${t.role} in ('user', 'assistant')`)],
);

/** Window positions, sizes and which are open — so the desk looks the same on every device. */
export const windowLayout = pgTable('window_layout', {
  key: text('key').primaryKey(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  w: integer('w').notNull(),
  h: integer('h'),
  open: boolean('open').notNull().default(false),
  z: integer('z').notNull().default(0),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

/** The single password, stored only as an argon2id hash. Deleting this row resets the password. */
export const auth = pgTable(
  'auth',
  {
    id: integer('id').primaryKey().default(1),
    passwordHash: text('password_hash').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('auth_singleton', sql`${t.id} = 1`)],
);

/** Login sessions. `id` is an HMAC of the random cookie token — the token itself is never stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    /** Last user activity; 30 minutes without any locks the session until the password is entered again. */
    lastActiveAt: tz('last_active_at').notNull().defaultNow(),
    /** Set by "Lock screen" / idle lock. */
    lockedAt: tz('locked_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_expires_at_idx').on(t.expiresAt)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    at: tz('at').notNull().defaultNow(),
    ip: text('ip'),
    ok: boolean('ok').notNull(),
  },
  (t) => [index('login_attempts_at_idx').on(t.at)],
);
