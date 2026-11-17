import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { shiftDay, zonedParts } from '@/lib/shared/dates';
import { uid } from '@/lib/shared/ids';
import type { Item, Settings } from '@/lib/shared/types';

export const TIME_ZONE = 'Asia/Dubai';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export const SYSTEM_PROMPT = `You are the planning assistant inside Sol's personal desktop planner. Sol is a designer and frontend developer in Dubai who is working on two projects at once, and wants help planning days, weeks and months and remembering everything.

Be a warm, direct planning coach. Keep answers short and scannable: a one-line take first, then a few bullets or a simple time-blocked schedule with one line per block (HH:MM – task). Work from the planner data below. Suggest realistic blocks with breaks, protect focus time, and point out clashes, overdue items and anything that looks forgotten. If something you need is missing, ask one short question.

Adding to the planner: call add_items only when Sol asks you to add, schedule or put something in the planner. When you propose a plan, offer to add it rather than adding it unasked. Only say something was added after add_items has succeeded.

Format replies as plain text: short paragraphs, "- " bullets and **bold** for emphasis. No headings, tables or code blocks.`;

/** The add_items tool. Input is streamed eagerly, so it is validated with AddItemsIn before anything is saved. */
export const ADD_ITEMS_TOOL = {
  name: 'add_items',
  description:
    "Add to-dos, events or meetings to Sol's planner. Use only when Sol asks you to add, schedule or put something in the planner.",
  eager_input_streaming: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['task', 'event', 'meeting'], description: 'task = to-do' },
            title: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD, or empty for "someday"' },
            time: { type: 'string', description: 'HH:MM, 24-hour. Optional.' },
            dur: { type: 'number', description: 'Length in minutes. Optional.' },
            project: { type: 'string', enum: ['p1', 'p2', ''], description: 'p1 or p2 (see the planner data), or empty' },
            notes: { type: 'string' },
          },
          required: ['type', 'title'],
        },
      },
    },
    required: ['items'],
  },
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const AddItemsIn = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(['task', 'event', 'meeting']),
        title: z.string().trim().min(1).max(500),
        date: z.string().optional(),
        time: z.string().optional(),
        dur: z.number().optional(),
        project: z.enum(['p1', 'p2', '']).optional(),
        notes: z.string().max(5000).optional(),
      }),
    )
    .min(1)
    .max(20),
});

const validDay = (d?: string) => {
  if (!d || !DAY.test(d)) return null;
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d) ? d : null;
};

/** Turn validated tool input into planner items. */
export function toolItemsToItems(input: z.infer<typeof AddItemsIn>, now = new Date()): Item[] {
  const stamp = now.toISOString();
  return input.items.map((x) => {
    const time = x.time && HM.test(x.time) && x.type !== 'task' ? x.time : null;
    const dur = Number.isFinite(x.dur) && x.dur! > 0 ? Math.round(x.dur!) : x.type === 'meeting' ? 30 : x.type === 'event' ? 60 : 0;
    return {
      id: uid(),
      type: x.type,
      title: x.title.slice(0, 140),
      date: validDay(x.date),
      time,
      dur,
      project: x.project === 'p1' || x.project === 'p2' ? x.project : null,
      done: false,
      doneAt: null,
      month: false,
      with: '',
      link: '',
      notes: x.notes ?? '',
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    };
  });
}

/** Today in Dubai and the window of items the planner sees: 14 days back to 60 days ahead. */
export function plannerWindow(now = new Date()) {
  const z = zonedParts(now, TIME_ZONE);
  return { ...z, from: shiftDay(z.day, -14), to: shiftDay(z.day, 60) };
}

const oneLine = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** The planner data block sent with every message. */
export function contextBlock(items: Item[], settings: Settings, now = new Date()): string {
  const w = plannerWindow(now);
  const pn = (p: Item['project']) => (p === 'p1' ? settings.p1.name : p === 'p2' ? settings.p2.name : '-');
  const proj = (k: 'p1' | 'p2') => {
    const s = settings[k];
    return `${k} = "${s.name}"${s.notes.trim() ? ` (notes: ${oneLine(s.notes, 600)})` : ''}`;
  };
  const rows = items
    .slice(0, 150)
    .map((x) =>
      [
        x.type === 'task' ? 'to-do' : x.type,
        x.month && x.date ? x.date.slice(0, 7) + ' (any day that month)' : x.date || 'no date (someday)',
        x.time || '-',
        x.dur || '-',
        pn(x.project),
        x.done ? 'done' : x.date && x.date < w.day && x.type === 'task' ? 'open, OVERDUE' : 'open',
        oneLine(x.title, 140),
        [x.with && 'with ' + x.with, oneLine(x.notes, 200)].filter(Boolean).join('; ') || '-',
      ].join(' | '),
    );
  return `--- Planner data ---
Now: ${w.weekday} ${w.day} ${w.time} (Dubai time).
Projects: ${proj('p1')}; ${proj('p2')}.
Items from ${w.from} to ${w.to}, plus undated ones and anything finished in the last 7 days
(type | date | time | minutes | project | status | title | details):
${rows.join('\n') || '(nothing planned yet)'}
--- End of planner data ---`;
}

/** Server-side refusal fallback is available on these models (beta `server-side-fallback-2026-07-01`). */
export function fallbackParams(model: string): { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } | Record<string, never> {
  return /^claude-(sonnet-5-5|opus-5|opus-5-5|fable-5)/.test(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : {};
}
