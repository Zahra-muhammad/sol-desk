import 'server-only';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Backup, ChatMessage, DeskDelta, DeskState, Item, Note, Settings, SettingsPatch, TimeEntry, WinLayout } from '@/lib/shared/types';
import type { DB } from './db/client';
import { chatMessages, items, notes, settings, timeEntries, windowLayout } from './db/schema';
import { EntryIn, ItemIn, LayoutIn, NoteIn, SettingsPatchIn, normalizeImportedEntry, normalizeImportedItem } from './validate';

type ItemRow = typeof items.$inferSelect;
type SettingsRow = typeof settings.$inferSelect;

const CHAT_LIMIT = 60;
/** Overlap on "since" queries so a slow concurrent write is never missed. Merging is idempotent. */
const OVERLAP_MS = 10_000;
/** A client clock can't push an edit further than this into the future. */
const MAX_FUTURE_MS = 60_000;

export function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    date: r.date,
    time: r.time,
    dur: r.dur,
    project: r.project,
    done: r.done,
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    month: r.month,
    with: r.with,
    link: r.link,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}

export function toEntry(r: typeof timeEntries.$inferSelect): TimeEntry {
  return {
    id: r.id,
    label: r.label,
    project: r.project,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}

export function toNote(r: typeof notes.$inferSelect): Note {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}

function toSettings(r: SettingsRow): Settings {
  return {
    p1: { name: r.p1Name, notes: r.p1Notes },
    p2: { name: r.p2Name, notes: r.p2Notes },
    theme: r.theme,
    sound: r.sound,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toChat(r: typeof chatMessages.$inferSelect): ChatMessage {
  return { id: r.id, role: r.role, content: r.content, addedCount: r.addedCount, createdAt: r.createdAt.toISOString() };
}

function toLayout(r: typeof windowLayout.$inferSelect): WinLayout {
  return { key: r.key as WinLayout['key'], x: r.x, y: r.y, w: r.w, h: r.h, open: r.open, z: r.z };
}

const ex = (col: string) => sql.raw(`excluded."${col}"`);

/** The database clock — used for sync cursors so every device agrees on "since". */
async function dbNow(db: DB): Promise<Date> {
  await ensureSettings(db);
  const [r] = await db
    .select({ now: sql<Date>`now()`.mapWith(settings.updatedAt) })
    .from(settings)
    .limit(1);
  return r.now;
}

// ---------------------------------------------------------------- items

/**
 * Upsert items. Newest `updatedAt` wins: an incoming edit older than what's stored is ignored.
 * Deletes are the same write with `deletedAt` set (soft delete). Returns the server's copy of each.
 */
export async function pushItems(db: DB, list: Item[], opts: { force?: boolean; now?: Date } = {}): Promise<Item[]> {
  if (!list.length) return [];
  const now = opts.now ?? new Date();
  const latest = new Map<string, Item>();
  for (const it of list) {
    const cur = latest.get(it.id);
    if (!cur || cur.updatedAt <= it.updatedAt) latest.set(it.id, it);
  }
  const rows = [...latest.values()].map((it) => ({
    id: it.id,
    type: it.type,
    title: it.title,
    date: it.date,
    time: it.time,
    dur: it.dur,
    project: it.project,
    done: it.done,
    doneAt: it.doneAt ? new Date(it.doneAt) : null,
    month: it.month,
    with: it.with,
    link: it.link,
    notes: it.notes,
    createdAt: new Date(it.createdAt),
    updatedAt: new Date(Math.min(Date.parse(it.updatedAt), now.getTime() + MAX_FUTURE_MS)),
    deletedAt: it.deletedAt ? new Date(it.deletedAt) : null,
    syncedAt: sql`now()`,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(items)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: items.id,
        set: {
          type: ex('type'),
          title: ex('title'),
          date: ex('date'),
          time: ex('time'),
          dur: ex('dur'),
          project: ex('project'),
          done: ex('done'),
          doneAt: ex('done_at'),
          month: ex('month'),
          with: ex('with'),
          link: ex('link'),
          notes: ex('notes'),
          updatedAt: ex('updated_at'),
          deletedAt: ex('deleted_at'),
          syncedAt: sql`now()`,
        },
        ...(opts.force ? {} : { setWhere: sql`${items.updatedAt} <= excluded.updated_at` }),
      });
  }
  const ids = [...latest.keys()];
  const out: Item[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const got = await db.select().from(items).where(inArray(items.id, ids.slice(i, i + 500)));
    out.push(...got.map(toItem));
  }
  return out;
}

export async function getItem(db: DB, id: string): Promise<Item | null> {
  const [r] = await db.select().from(items).where(eq(items.id, id));
  return r ? toItem(r) : null;
}

export async function liveItems(db: DB): Promise<Item[]> {
  const rows = await db.select().from(items).where(isNull(items.deletedAt)).orderBy(asc(items.date), asc(items.time));
  return rows.map(toItem);
}

// ---------------------------------------------------------------- time entries

/** Upsert tracked time. Same rules as items: newest updatedAt wins, deletes are soft. */
export async function pushEntries(db: DB, list: TimeEntry[], opts: { force?: boolean; now?: Date } = {}): Promise<TimeEntry[]> {
  if (!list.length) return [];
  const now = opts.now ?? new Date();
  const latest = new Map<string, TimeEntry>();
  for (const e of list) {
    const cur = latest.get(e.id);
    if (!cur || cur.updatedAt <= e.updatedAt) latest.set(e.id, e);
  }
  const rows = [...latest.values()].map((e) => ({
    id: e.id,
    label: e.label,
    project: e.project,
    startedAt: new Date(e.startedAt),
    endedAt: e.endedAt ? new Date(e.endedAt) : null,
    createdAt: new Date(e.createdAt),
    updatedAt: new Date(Math.min(Date.parse(e.updatedAt), now.getTime() + MAX_FUTURE_MS)),
    deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
    syncedAt: sql`now()`,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(timeEntries)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: timeEntries.id,
        set: {
          label: ex('label'),
          project: ex('project'),
          startedAt: ex('started_at'),
          endedAt: ex('ended_at'),
          updatedAt: ex('updated_at'),
          deletedAt: ex('deleted_at'),
          syncedAt: sql`now()`,
        },
        ...(opts.force ? {} : { setWhere: sql`${timeEntries.updatedAt} <= excluded.updated_at` }),
      });
  }
  const ids = [...latest.keys()];
  const out: TimeEntry[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...(await db.select().from(timeEntries).where(inArray(timeEntries.id, ids.slice(i, i + 500)))).map(toEntry));
  }
  return out;
}

// ---------------------------------------------------------------- notebook

/** Upsert notebook pages. Newest updatedAt wins; deletes are soft. */
export async function pushNotes(db: DB, list: Note[], opts: { force?: boolean; now?: Date } = {}): Promise<Note[]> {
  if (!list.length) return [];
  const now = opts.now ?? new Date();
  const latest = new Map<string, Note>();
  for (const n of list) {
    const cur = latest.get(n.id);
    if (!cur || cur.updatedAt <= n.updatedAt) latest.set(n.id, n);
  }
  const rows = [...latest.values()].map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    createdAt: new Date(n.createdAt),
    updatedAt: new Date(Math.min(Date.parse(n.updatedAt), now.getTime() + MAX_FUTURE_MS)),
    deletedAt: n.deletedAt ? new Date(n.deletedAt) : null,
    syncedAt: sql`now()`,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(notes)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: notes.id,
        set: { title: ex('title'), body: ex('body'), updatedAt: ex('updated_at'), deletedAt: ex('deleted_at'), syncedAt: sql`now()` },
        ...(opts.force ? {} : { setWhere: sql`${notes.updatedAt} <= excluded.updated_at` }),
      });
  }
  const ids = [...latest.keys()];
  const out: Note[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...(await db.select().from(notes).where(inArray(notes.id, ids.slice(i, i + 500)))).map(toNote));
  }
  return out;
}

export async function liveNotes(db: DB): Promise<Note[]> {
  const rows = await db.select().from(notes).where(isNull(notes.deletedAt)).orderBy(desc(notes.updatedAt));
  return rows.map(toNote);
}

/** Entries from the last 60 days, plus a timer that is still running however old. */
export async function liveEntries(db: DB, days = 60): Promise<TimeEntry[]> {
  const from = new Date(Date.now() - days * 864e5);
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(isNull(timeEntries.deletedAt), or(gt(timeEntries.startedAt, from), isNull(timeEntries.endedAt))))
    .orderBy(asc(timeEntries.startedAt));
  return rows.map(toEntry);
}

// ---------------------------------------------------------------- settings

export async function ensureSettings(db: DB) {
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
}

export async function getSettings(db: DB): Promise<Settings> {
  await ensureSettings(db);
  const [r] = await db.select().from(settings).where(eq(settings.id, 1));
  return toSettings(r);
}

export async function patchSettings(db: DB, p: SettingsPatch): Promise<Settings> {
  await ensureSettings(db);
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length) {
    await db
      .update(settings)
      .set({ ...clean, updatedAt: sql`now()`, syncedAt: sql`now()` })
      .where(eq(settings.id, 1));
  }
  return getSettings(db);
}

// ---------------------------------------------------------------- chat

export async function listChat(db: DB, limit = CHAT_LIMIT): Promise<ChatMessage[]> {
  const rows = await db.select().from(chatMessages).orderBy(desc(chatMessages.id)).limit(limit);
  return rows.reverse().map(toChat);
}

export async function addChat(db: DB, role: 'user' | 'assistant', content: string, addedCount = 0): Promise<ChatMessage> {
  const [r] = await db.insert(chatMessages).values({ role, content, addedCount }).returning();
  return toChat(r);
}

export async function clearChat(db: DB) {
  await ensureSettings(db);
  await db.delete(chatMessages);
  await db
    .update(settings)
    .set({ chatClearedAt: sql`now()`, syncedAt: sql`now()` })
    .where(eq(settings.id, 1));
}

// ---------------------------------------------------------------- layout

export async function putLayout(db: DB, list: WinLayout[]) {
  for (const l of list) {
    await db
      .insert(windowLayout)
      .values({ ...l, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: windowLayout.key,
        set: { x: l.x, y: l.y, w: l.w, h: l.h, open: l.open, z: l.z, updatedAt: sql`now()` },
      });
  }
}

export async function getLayout(db: DB): Promise<WinLayout[]> {
  return (await db.select().from(windowLayout)).map(toLayout);
}

// ---------------------------------------------------------------- whole-desk reads

export async function getState(db: DB): Promise<DeskState> {
  const cursor = await dbNow(db);
  const its = await liveItems(db);
  const entries = await liveEntries(db);
  const nts = await liveNotes(db);
  const [st, chat, layout] = [await getSettings(db), await listChat(db), await getLayout(db)];
  return { items: its, entries, notes: nts, settings: st, chat, layout, cursor: cursor.toISOString() };
}

/** Everything that changed since `since` — including deletions, so other devices drop them too. */
export async function getDelta(db: DB, since: Date): Promise<DeskDelta> {
  const cursor = await dbNow(db);
  const lower = new Date(since.getTime() - OVERLAP_MS);
  const changed = await db.select().from(items).where(gt(items.syncedAt, lower));
  const changedEntries = await db.select().from(timeEntries).where(gt(timeEntries.syncedAt, lower));
  const changedNotes = await db.select().from(notes).where(gt(notes.syncedAt, lower));
  const [s] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.id, 1), gt(settings.syncedAt, lower)));
  const newMsg = await db.select({ id: chatMessages.id }).from(chatMessages).where(gt(chatMessages.createdAt, lower)).limit(1);
  const chatChanged = newMsg.length > 0 || !!(s?.chatClearedAt && s.chatClearedAt > lower);
  return {
    items: changed.map(toItem),
    entries: changedEntries.map(toEntry),
    notes: changedNotes.map(toNote),
    settings: s ? toSettings(s) : null,
    chat: chatChanged ? await listChat(db) : null,
    cursor: cursor.toISOString(),
  };
}

// ---------------------------------------------------------------- planner context

/** Open items from 14 days ago to 60 days ahead (plus undated), and anything finished in the last 7 days. */
export async function plannerItems(db: DB, today: string, from: string, to: string): Promise<Item[]> {
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        isNull(items.deletedAt),
        or(
          and(eq(items.done, false), or(isNull(items.date), and(sql`${items.date} >= ${from}`, sql`${items.date} <= ${to}`))),
          and(eq(items.done, true), gt(items.doneAt, weekAgo)),
        ),
      ),
    )
    .orderBy(asc(items.date), asc(items.time))
    .limit(200);
  void today;
  return rows.map(toItem);
}

// ---------------------------------------------------------------- backup

export async function exportAll(db: DB): Promise<Backup> {
  const all = (await db.select().from(items).orderBy(asc(items.createdAt))).map(toItem);
  const st = await getSettings(db);
  const chat = (await db.select().from(chatMessages).orderBy(asc(chatMessages.id))).map(toChat);
  return {
    app: 'sol-desk',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: all,
    entries: (await db.select().from(timeEntries).orderBy(asc(timeEntries.startedAt))).map(toEntry),
    notes: (await db.select().from(notes).orderBy(asc(notes.createdAt))).map(toNote),
    settings: { p1: st.p1, p2: st.p2, theme: st.theme, sound: st.sound },
    chat,
    layout: await getLayout(db),
  };
}

export class ImportError extends Error {}

/**
 * Restore a backup. Every item in the file is written as it is in the file (and wins over the
 * server's copy, including bringing back deleted ones). Items not in the file are left alone.
 */
export async function importBackup(db: DB, raw: unknown): Promise<{ items: number; entries: number; notes: number; skipped: number }> {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) {
    throw new ImportError('Not a desk backup: expected an "items" list.');
  }
  const data = raw as { items: unknown[]; settings?: unknown; chat?: unknown; layout?: unknown };
  const now = new Date();
  const good: Item[] = [];
  let skipped = 0;
  for (const r of data.items) {
    const p = ItemIn.safeParse(normalizeImportedItem(r, now));
    if (p.success) good.push(p.data);
    else skipped++;
  }
  await pushItems(db, good, { force: true, now });

  let entriesIn = 0;
  if (Array.isArray((raw as { entries?: unknown }).entries)) {
    const ok: TimeEntry[] = [];
    for (const r of (raw as { entries: unknown[] }).entries) {
      const p = EntryIn.safeParse(normalizeImportedEntry(r, now));
      if (p.success) ok.push(p.data);
      else skipped++;
    }
    await pushEntries(db, ok, { force: true, now });
    entriesIn = ok.length;
  }

  let notesIn = 0;
  if (Array.isArray((raw as { notes?: unknown }).notes)) {
    const ok: Note[] = [];
    for (const r of (raw as { notes: unknown[] }).notes) {
      const p = NoteIn.safeParse(normalizeImportedEntry(r, now));
      if (p.success) ok.push(p.data);
      else skipped++;
    }
    await pushNotes(db, ok, { force: true, now });
    notesIn = ok.length;
  }

  const s = data.settings as { p1?: { name?: unknown; notes?: unknown }; p2?: { name?: unknown; notes?: unknown }; theme?: unknown; sound?: unknown } | undefined;
  if (s && typeof s === 'object') {
    const patch = SettingsPatchIn.safeParse({
      p1Name: s.p1?.name,
      p1Notes: s.p1?.notes,
      p2Name: s.p2?.name,
      p2Notes: s.p2?.notes,
      theme: s.theme,
      sound: s.sound,
    });
    if (patch.success) await patchSettings(db, patch.data);
  }

  if (Array.isArray(data.chat)) {
    const have = new Set((await db.select().from(chatMessages)).map((m) => m.createdAt.toISOString() + m.role + m.content));
    for (const m of data.chat as Partial<ChatMessage>[]) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
      const at = m.createdAt && !Number.isNaN(Date.parse(m.createdAt)) ? new Date(m.createdAt) : now;
      if (have.has(at.toISOString() + m.role + m.content)) continue;
      await db.insert(chatMessages).values({ role: m.role, content: m.content.slice(0, 20000), addedCount: Math.max(0, Number(m.addedCount) || 0), createdAt: at });
    }
  }

  if (Array.isArray(data.layout)) {
    const ls = data.layout.map((l) => LayoutIn.safeParse(l)).filter((p) => p.success).map((p) => p.data!);
    if (ls.length) await putLayout(db, ls);
  }

  return { items: good.length, entries: entriesIn, notes: notesIn, skipped };
}
