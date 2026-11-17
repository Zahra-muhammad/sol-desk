import 'server-only';
import { z } from 'zod';
import { ID_RE } from '@/lib/shared/ids';
import { WINDOW_KEYS, type Item, type Note, type SettingsPatch, type TimeEntry, type WinLayout } from '@/lib/shared/types';

const isIso = (v: string) => !Number.isNaN(Date.parse(v));
const isDay = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
};

const ts = z.string().refine(isIso, 'not a timestamp');
const clip = (max: number) =>
  z
    .string()
    .catch('')
    .transform((s) => s.slice(0, max));

/**
 * An item from the client. Lenient on purpose: a bad field falls back to a safe value
 * rather than blocking the whole save. Only `id` and `updatedAt` are strictly required.
 */
export const ItemIn = z.object({
  id: z.string().regex(ID_RE),
  type: z.enum(['task', 'event', 'meeting']).catch('task'),
  title: z
    .string()
    .catch('')
    .transform((s) => s.trim().slice(0, 500) || 'Untitled'),
  date: z.string().refine(isDay).nullable().catch(null),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .catch(null),
  dur: z.coerce
    .number()
    .transform((n) => (Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n))) : 0))
    .catch(0),
  project: z.enum(['p1', 'p2']).nullable().catch(null),
  done: z.boolean().catch(false),
  doneAt: ts.nullable().catch(null),
  month: z.boolean().catch(false),
  with: clip(500),
  link: clip(2000),
  notes: clip(20000),
  createdAt: ts.catch(() => new Date().toISOString()),
  updatedAt: ts,
  deletedAt: ts.nullable().catch(null),
}) satisfies z.ZodType<Item, unknown>;

/** A tracked-time entry from the client. */
export const EntryIn = z.object({
  id: z.string().regex(ID_RE),
  label: clip(300),
  project: z.enum(['p1', 'p2']).nullable().catch(null),
  startedAt: ts,
  endedAt: ts.nullable().catch(null),
  createdAt: ts.catch(() => new Date().toISOString()),
  updatedAt: ts,
  deletedAt: ts.nullable().catch(null),
}) satisfies z.ZodType<TimeEntry, unknown>;

/** A notebook page from the client. */
export const NoteIn = z.object({
  id: z.string().regex(ID_RE),
  title: clip(300),
  body: clip(200_000),
  createdAt: ts.catch(() => new Date().toISOString()),
  updatedAt: ts,
  deletedAt: ts.nullable().catch(null),
}) satisfies z.ZodType<Note, unknown>;

const name = z
  .string()
  .transform((s) => s.trim().slice(0, 80) || 'untitled');

export const SettingsPatchIn = z.object({
  p1Name: name.optional(),
  p1Notes: z.string().max(50000).optional(),
  p2Name: name.optional(),
  p2Notes: z.string().max(50000).optional(),
  theme: z.enum(['dark', 'light']).optional(),
  sound: z.boolean().optional(),
}) satisfies z.ZodType<SettingsPatch, unknown>;

const coord = z.coerce.number().transform((n) => Math.round(Math.max(-5000, Math.min(10000, n))));

export const LayoutIn = z.object({
  key: z.enum(WINDOW_KEYS),
  x: coord,
  y: coord,
  w: coord,
  h: coord.nullable(),
  open: z.boolean(),
  z: z.coerce.number().int().min(0).max(100),
}) satisfies z.ZodType<WinLayout, unknown>;

export const PushIn = z.object({
  items: z.array(ItemIn).max(1000).optional(),
  entries: z.array(EntryIn).max(1000).optional(),
  notes: z.array(NoteIn).max(1000).optional(),
  settings: SettingsPatchIn.optional(),
  layout: z.array(LayoutIn).max(20).optional(),
});

export const PasswordIn = z.object({ password: z.string().min(1).max(1024) });
export const ChangePasswordIn = z.object({ current: z.string().min(1).max(1024), next: z.string().max(1024).optional() });
export const PlannerIn = z.object({ message: z.string().trim().min(1).max(4000) });

/** Imported time entries and notes win over the server's copy, like imported items. */
export function normalizeImportedEntry(raw: unknown, now: Date): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  return { ...(raw as Record<string, unknown>), updatedAt: now.toISOString() };
}

/**
 * Backups from this app, and the prototype's "Copy all my data" JSON
 * (dates as '' and timestamps as numbers) — both import cleanly.
 */
export function normalizeImportedItem(raw: unknown, now: Date): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const toIso = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : typeof v === 'string' && v ? v : null;
  for (const k of ['date', 'time', 'project'] as const) if (r[k] === '') r[k] = null;
  if (r.createdAt === undefined && r.created !== undefined) r.createdAt = toIso(r.created);
  if (typeof r.doneAt === 'number') r.doneAt = toIso(r.doneAt);
  if (typeof r.createdAt === 'number') r.createdAt = toIso(r.createdAt);
  r.with ??= '';
  r.link ??= '';
  r.notes ??= '';
  // An import always wins over what is on the server — that's the point of restoring a backup.
  r.updatedAt = now.toISOString();
  return r;
}
