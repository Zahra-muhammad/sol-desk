import 'server-only';
import { and, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { zonedToUtc } from '@/lib/shared/alarm';
import { shiftDay, zonedParts } from '@/lib/shared/dates';
import { uid } from '@/lib/shared/ids';
import { fmtDur } from '@/lib/shared/time';
import { WINDOW_KEYS, type Alarm, type Item, type Note, type Settings, type SettingsPatch, type TimeEntry } from '@/lib/shared/types';
import type { DB } from './db/client';
import { alarms, items, notes, timeEntries } from './db/schema';
import { AddItemsIn, toolItemsToItems } from './planner';
import { getSettings, patchSettings, pushAlarms, pushEntries, pushItems, pushNotes, toAlarm, toEntry, toItem, toNote } from './repo';

export interface ToolCtx {
  db: DB;
  /** IANA time zone of Sol's browser ("4pm" means 4pm there). */
  tz: string;
  now: Date;
}

/** What a tool did: the result for the model, records for the screen, and a one-line summary for the chat. */
export interface ToolOutcome {
  result: unknown;
  isError?: boolean;
  changed?: { items?: Item[]; entries?: TimeEntry[]; notes?: Note[]; alarms?: Alarm[]; settings?: Settings };
  ui?: { action: 'open' | 'close' | 'lock' | 'desktop'; window?: string }[];
  did?: string[];
  /** New calendar items (for "✓ Added n to your calendar"). */
  added?: number;
}

// ---------------------------------------------------------------- tool definitions (sent to Claude)

const s = (description: string) => ({ type: 'string', description });
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  name,
  description,
  eager_input_streaming: true,
  input_schema: { type: 'object' as const, properties, required },
});

const ITEM_FIELDS = {
  type: { type: 'string', enum: ['task', 'event', 'meeting'], description: 'task = to-do' },
  title: s('Title'),
  date: s('YYYY-MM-DD, or "" for no date (someday)'),
  time: s('HH:MM 24-hour, or "" for none. To-dos have no time.'),
  dur: { type: 'number', description: 'Length in minutes' },
  project: { type: 'string', enum: ['p1', 'p2', ''], description: 'p1, p2 or "" for none' },
  notes: s('Notes (replaces existing notes)'),
};

export const TOOLS = [
  tool(
    'add_items',
    "Add to-dos, events or meetings to Sol's planner. Use only when Sol asks you to add, schedule or put something in the planner.",
    {
      items: {
        type: 'array',
        maxItems: 20,
        items: { type: 'object', properties: ITEM_FIELDS, required: ['type', 'title'] },
      },
    },
    ['items'],
  ),
  tool(
    'update_items',
    'Change existing to-dos, events or meetings by id (from the planner data): move date/time, rename, re-file to a project, mark done or not done, edit notes. Only send the fields that change.',
    {
      items: {
        type: 'array',
        maxItems: 30,
        items: {
          type: 'object',
          properties: {
            id: s('Item id from the planner data'),
            ...ITEM_FIELDS,
            done: { type: 'boolean', description: 'Mark done (true) or not done (false)' },
            append_notes: s('Text to add to the end of the existing notes'),
            with: s('People (meetings)'),
            link: s('Link or place (meetings)'),
          },
          required: ['id'],
        },
      },
    },
    ['items'],
  ),
  tool('delete_items', 'Delete to-dos, events or meetings by id. Only when Sol clearly asks to delete or clear them.', { ids: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, ['ids']),
  tool(
    'set_alarm',
    'Set an alarm or countdown that rings: "set a timer till 4pm" (time 16:00), "25 minute timer" (in_minutes 25), "remind me tomorrow at 9" (date + time). Give either in_minutes, or time (+ optional date).',
    {
      label: s('What it is for, e.g. "Leave for the meeting". Optional.'),
      time: s('HH:MM 24-hour, in Sol\'s time zone'),
      date: s('YYYY-MM-DD. Optional; defaults to today, or tomorrow if that time has passed.'),
      in_minutes: { type: 'number', description: 'Ring this many minutes from now' },
    },
  ),
  tool('cancel_alarms', 'Cancel alarms or countdowns by id (from the planner data).', { ids: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, ['ids']),
  tool(
    'start_timer',
    'Start tracking time (the time tracker / stopwatch in timer.app — it does not ring). Stops any timer already running.',
    { label: s('What Sol is working on'), project: { type: 'string', enum: ['p1', 'p2', ''] } },
  ),
  tool('stop_timer', 'Stop the time tracker if it is running.', {}),
  tool('add_note', "Write a new page in Sol's notebook.", { title: s('Title'), body: s('The note text') }, ['title']),
  tool(
    'update_note',
    'Edit a notebook page by id: replace the title or body, or append text to the end.',
    { id: s('Note id from the planner data'), title: s('New title'), body: s('New body (replaces it)'), append: s('Text to add at the end') },
    ['id'],
  ),
  tool('delete_notes', 'Delete notebook pages by id. Only when Sol clearly asks.', { ids: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, ['ids']),
  tool(
    'update_settings',
    'Rename a project, replace its notes, switch light/dark theme, or turn sound on/off.',
    {
      p1_name: s('New name for project p1'),
      p2_name: s('New name for project p2'),
      p1_notes: s('Replace project p1 notes'),
      p2_notes: s('Replace project p2 notes'),
      theme: { type: 'string', enum: ['dark', 'light'] },
      sound: { type: 'boolean' },
    },
  ),
  tool(
    'desk_action',
    'Do something on the desk screen: open or close a window, show the desktop, or lock the screen.',
    {
      action: { type: 'string', enum: ['open', 'close', 'show_desktop', 'lock'] },
      window: {
        type: 'string',
        enum: [...WINDOW_KEYS],
        description: 'today, calendar, meetings, todo, p1, p2 (project folders), future, chat, timer (time tracker), notes (notebook), alarms',
      },
    },
    ['action'],
  ),
];

// ---------------------------------------------------------------- input validation

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isDay = (d: string) => DAY.test(d) && new Date(d + 'T00:00:00Z').toISOString().startsWith(d);
const ids = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(50) });

const In = {
  update_items: z.object({
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          type: z.enum(['task', 'event', 'meeting']).optional(),
          title: z.string().trim().min(1).max(500).optional(),
          date: z.string().optional(),
          time: z.string().optional(),
          dur: z.number().min(0).max(100000).optional(),
          project: z.enum(['p1', 'p2', '']).optional(),
          notes: z.string().max(20000).optional(),
          append_notes: z.string().max(20000).optional(),
          done: z.boolean().optional(),
          with: z.string().max(500).optional(),
          link: z.string().max(2000).optional(),
        }),
      )
      .min(1)
      .max(30),
  }),
  delete_items: ids,
  set_alarm: z.object({
    label: z.string().max(300).optional(),
    time: z.string().optional(),
    date: z.string().optional(),
    in_minutes: z.number().positive().max(60 * 24 * 60).optional(),
  }),
  cancel_alarms: ids,
  start_timer: z.object({ label: z.string().max(300).optional(), project: z.enum(['p1', 'p2', '']).optional() }),
  stop_timer: z.object({}).passthrough(),
  add_note: z.object({ title: z.string().max(300), body: z.string().max(200000).optional() }),
  update_note: z.object({
    id: z.string().min(1).max(64),
    title: z.string().max(300).optional(),
    body: z.string().max(200000).optional(),
    append: z.string().max(200000).optional(),
  }),
  delete_notes: ids,
  update_settings: z.object({
    p1_name: z.string().max(80).optional(),
    p2_name: z.string().max(80).optional(),
    p1_notes: z.string().max(50000).optional(),
    p2_notes: z.string().max(50000).optional(),
    theme: z.enum(['dark', 'light']).optional(),
    sound: z.boolean().optional(),
  }),
  desk_action: z.object({ action: z.enum(['open', 'close', 'show_desktop', 'lock']), window: z.enum(WINDOW_KEYS).optional() }),
};

// ---------------------------------------------------------------- helpers

/** A timestamp newer than `prev`, so the planner's edit wins over the stored copy. */
const stampAfter = (now: Date, prev?: string) => new Date(Math.max(now.getTime(), prev ? Date.parse(prev) + 1 : 0)).toISOString();
const hmIn = (d: Date, tz: string) => zonedParts(d, tz).time;
const whenIn = (d: Date, ctx: ToolCtx) => {
  const day = zonedParts(d, ctx.tz).day;
  const today = zonedParts(ctx.now, ctx.tz).day;
  const t = hmIn(d, ctx.tz);
  return day === today ? t : day === shiftDay(today, 1) ? `tomorrow ${t}` : `${day} ${t}`;
};
const quote = (t: string) => `“${t.length > 40 ? t.slice(0, 39) + '…' : t}”`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fail = (msg: string): ToolOutcome => ({ result: { ok: false, error: msg }, isError: true });

async function liveByIds<T>(db: DB, table: typeof items | typeof notes | typeof alarms, idList: string[], map: (r: never) => T): Promise<T[]> {
  const rows = await db
    .select()
    .from(table as typeof items)
    .where(and(inArray((table as typeof items).id, idList), isNull((table as typeof items).deletedAt)));
  return rows.map((r) => map(r as never));
}

// ---------------------------------------------------------------- execution

export async function runTool(name: string, input: unknown, ctx: ToolCtx): Promise<ToolOutcome> {
  const { db, now, tz } = ctx;
  const t = now.toISOString();

  switch (name) {
    case 'add_items': {
      const p = AddItemsIn.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const saved = await pushItems(db, toolItemsToItems(p.data, now));
      return {
        result: { ok: true, added: saved.map((i) => ({ id: i.id, title: i.title, date: i.date, time: i.time })) },
        changed: { items: saved },
        added: saved.length,
        did: [`Added ${plural(saved.length, 'item')} to your calendar`],
      };
    }

    case 'update_items': {
      const p = In.update_items.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const cur = await liveByIds<Item>(db, items, p.data.items.map((x) => x.id), toItem);
      const byId = new Map(cur.map((x) => [x.id, x]));
      const missing = p.data.items.filter((x) => !byId.has(x.id)).map((x) => x.id);
      const next: Item[] = [];
      for (const u of p.data.items) {
        const it = byId.get(u.id);
        if (!it) continue;
        const n: Item = { ...it };
        if (u.type) n.type = u.type;
        if (u.title !== undefined) n.title = u.title.slice(0, 140);
        if (u.date !== undefined) n.date = u.date === '' ? null : isDay(u.date) ? u.date : n.date;
        if (u.time !== undefined) n.time = u.time === '' ? null : HM.test(u.time) ? u.time : n.time;
        if (u.dur !== undefined) n.dur = Math.round(u.dur);
        if (u.project !== undefined) n.project = u.project || null;
        if (u.notes !== undefined) n.notes = u.notes;
        if (u.append_notes) n.notes = (n.notes ? n.notes.replace(/\s+$/, '') + '\n' : '') + u.append_notes;
        if (u.with !== undefined) n.with = u.with;
        if (u.link !== undefined) n.link = u.link;
        if (u.done !== undefined && u.done !== n.done) {
          n.done = u.done;
          n.doneAt = u.done ? t : null;
        }
        if (n.type === 'task') n.time = null;
        else n.month = false;
        n.updatedAt = stampAfter(now, it.updatedAt);
        next.push(n);
      }
      const saved = await pushItems(db, next);
      const doneOnly = p.data.items.every((u) => Object.keys(u).every((k) => k === 'id' || k === 'done'));
      const did = !saved.length
        ? []
        : doneOnly && saved.length === 1
          ? [`Marked ${quote(saved[0].title)} ${saved[0].done ? 'done' : 'not done'}`]
          : saved.length === 1
            ? [`Updated ${quote(saved[0].title)}`]
            : [`Updated ${plural(saved.length, 'item')}`];
      return {
        result: { ok: true, updated: saved.map((i) => ({ id: i.id, title: i.title, date: i.date, time: i.time, done: i.done })), not_found: missing },
        isError: !saved.length,
        changed: { items: saved },
        did,
      };
    }

    case 'delete_items': {
      const p = In.delete_items.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const cur = await liveByIds<Item>(db, items, p.data.ids, toItem);
      const saved = await pushItems(db, cur.map((x) => ({ ...x, deletedAt: t, updatedAt: stampAfter(now, x.updatedAt) })));
      return {
        result: { ok: true, deleted: cur.map((x) => x.title), not_found: p.data.ids.filter((id) => !cur.some((x) => x.id === id)) },
        changed: { items: saved },
        did: saved.length ? [saved.length === 1 ? `Deleted ${quote(cur[0].title)}` : `Deleted ${plural(saved.length, 'item')}`] : [],
      };
    }

    case 'set_alarm': {
      const p = In.set_alarm.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      let at: Date;
      if (p.data.in_minutes) at = new Date(now.getTime() + p.data.in_minutes * 60e3);
      else if (p.data.time && HM.test(p.data.time)) {
        const today = zonedParts(now, tz).day;
        const day = p.data.date && isDay(p.data.date) ? p.data.date : today;
        at = zonedToUtc(day, p.data.time, tz);
        if (!p.data.date && at.getTime() <= now.getTime()) at = zonedToUtc(shiftDay(today, 1), p.data.time, tz);
      } else return fail('Give either in_minutes, or time as HH:MM (with an optional date).');
      if (at.getTime() <= now.getTime() - 60e3) return fail('That time has already passed.');
      const label = (p.data.label ?? '').trim();
      const [a] = await pushAlarms(db, [{ id: uid(), label, at: at.toISOString(), dismissedAt: null, createdAt: t, updatedAt: t, deletedAt: null }]);
      const mins = Math.round((at.getTime() - now.getTime()) / 60e3);
      const did = p.data.in_minutes
        ? `Timer set for ${fmtDur(mins * 60e3)} (rings at ${hmIn(at, tz)})`
        : `Alarm set for ${whenIn(at, ctx)}${label ? ` — ${label}` : ''}`;
      return { result: { ok: true, id: a.id, rings_at_local: whenIn(at, ctx), label }, changed: { alarms: [a] }, did: [did] };
    }

    case 'cancel_alarms': {
      const p = In.cancel_alarms.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const cur = await liveByIds<Alarm>(db, alarms, p.data.ids, toAlarm);
      const saved = await pushAlarms(db, cur.map((a) => ({ ...a, deletedAt: t, updatedAt: stampAfter(now, a.updatedAt) })));
      return {
        result: { ok: true, cancelled: saved.length, not_found: p.data.ids.filter((id) => !cur.some((x) => x.id === id)) },
        changed: { alarms: saved },
        did: saved.length ? [`Cancelled ${plural(saved.length, 'alarm')}`] : [],
      };
    }

    case 'start_timer':
    case 'stop_timer': {
      const running = (await db.select().from(timeEntries).where(and(isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)))).map(toEntry);
      const stopped = running.map((e) => ({ ...e, endedAt: t, updatedAt: stampAfter(now, e.updatedAt) }));
      if (name === 'stop_timer') {
        if (!running.length) return { result: { ok: true, note: 'No timer was running.' } };
        const saved = await pushEntries(db, stopped);
        const dur = fmtDur(now.getTime() - Date.parse(running[0].startedAt));
        return { result: { ok: true, stopped: running[0].label, duration: dur }, changed: { entries: saved }, did: [`Timer stopped (${dur})`] };
      }
      const p = In.start_timer.safeParse(input ?? {});
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const label = (p.data.label ?? '').trim();
      const fresh: TimeEntry = { id: uid(), label, project: p.data.project || null, startedAt: t, endedAt: null, createdAt: t, updatedAt: t, deletedAt: null };
      const saved = await pushEntries(db, [...stopped, fresh]);
      return { result: { ok: true, started: label || 'no label' }, changed: { entries: saved }, did: [`Timer started${label ? `: ${label}` : ''}`] };
    }

    case 'add_note': {
      const p = In.add_note.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const [n] = await pushNotes(db, [{ id: uid(), title: p.data.title.trim(), body: p.data.body ?? '', createdAt: t, updatedAt: t, deletedAt: null }]);
      return { result: { ok: true, id: n.id }, changed: { notes: [n] }, did: [`Note added: ${quote(n.title || 'Untitled')}`] };
    }

    case 'update_note': {
      const p = In.update_note.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const [cur] = await liveByIds<Note>(db, notes, [p.data.id], toNote);
      if (!cur) return fail('No note with that id.');
      const n: Note = { ...cur, updatedAt: stampAfter(now, cur.updatedAt) };
      if (p.data.title !== undefined) n.title = p.data.title;
      if (p.data.body !== undefined) n.body = p.data.body;
      if (p.data.append) n.body = (n.body ? n.body.replace(/\s+$/, '') + '\n' : '') + p.data.append;
      const [saved] = await pushNotes(db, [n]);
      return { result: { ok: true }, changed: { notes: [saved] }, did: [`Note updated: ${quote(saved.title || 'Untitled')}`] };
    }

    case 'delete_notes': {
      const p = In.delete_notes.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const cur = await liveByIds<Note>(db, notes, p.data.ids, toNote);
      const saved = await pushNotes(db, cur.map((n) => ({ ...n, deletedAt: t, updatedAt: stampAfter(now, n.updatedAt) })));
      return { result: { ok: true, deleted: saved.length }, changed: { notes: saved }, did: saved.length ? [`Deleted ${plural(saved.length, 'note')}`] : [] };
    }

    case 'update_settings': {
      const p = In.update_settings.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const before = await getSettings(db);
      const patch: SettingsPatch = {};
      const did: string[] = [];
      const name = (v: string) => v.trim().slice(0, 80) || 'untitled';
      if (p.data.p1_name !== undefined) (patch.p1Name = name(p.data.p1_name)), did.push(`Renamed ${quote(before.p1.name)} to ${quote(patch.p1Name)}`);
      if (p.data.p2_name !== undefined) (patch.p2Name = name(p.data.p2_name)), did.push(`Renamed ${quote(before.p2.name)} to ${quote(patch.p2Name)}`);
      if (p.data.p1_notes !== undefined) (patch.p1Notes = p.data.p1_notes), did.push(`Updated ${before.p1.name} notes`);
      if (p.data.p2_notes !== undefined) (patch.p2Notes = p.data.p2_notes), did.push(`Updated ${before.p2.name} notes`);
      if (p.data.theme) (patch.theme = p.data.theme), did.push(`Switched to ${p.data.theme} theme`);
      if (p.data.sound !== undefined) (patch.sound = p.data.sound), did.push(`Sound ${p.data.sound ? 'on' : 'off'}`);
      if (!did.length) return fail('Nothing to change.');
      const after = await patchSettings(db, patch);
      return { result: { ok: true }, changed: { settings: after }, did };
    }

    case 'desk_action': {
      const p = In.desk_action.safeParse(input);
      if (!p.success) return fail('Invalid input: ' + p.error.issues[0]?.message);
      const { action, window } = p.data;
      if ((action === 'open' || action === 'close') && !window) return fail('Say which window.');
      const ui = action === 'show_desktop' ? ({ action: 'desktop' } as const) : action === 'lock' ? ({ action: 'lock' } as const) : { action, window };
      const label = window === 'p1' || window === 'p2' ? (await getSettings(db))[window].name : window;
      const did = action === 'lock' ? 'Locked the screen' : action === 'show_desktop' ? 'Showed the desktop' : `${action === 'open' ? 'Opened' : 'Closed'} ${label}`;
      return { result: { ok: true }, ui: [ui], did: [did] };
    }

    default:
      return fail(`Unknown tool ${name}`);
  }
}

/** Tool names, for tests and the route. */
export const TOOL_NAMES = TOOLS.map((x) => x.name);

