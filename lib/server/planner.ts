import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { shiftDay, zonedParts } from '@/lib/shared/dates';
import { uid } from '@/lib/shared/ids';
import { fmtDur, totals } from '@/lib/shared/time';
import type { Alarm, Item, Note, Settings, TimeEntry } from '@/lib/shared/types';

export const TIME_ZONE = 'Asia/Dubai';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export const SYSTEM_PROMPT = `You are the planning assistant inside Sol's personal desktop planner. Sol is a designer and frontend developer in Dubai who is working on two projects at once, and wants help planning days, weeks and months and remembering everything.

Be a warm, direct planning coach. Keep answers short and scannable: a one-line take first, then a few bullets or a simple time-blocked schedule with one line per block (HH:MM – task). Work from the planner data below. Suggest realistic blocks with breaks, protect focus time, and point out clashes, overdue items and anything that looks forgotten. If something you need is missing, ask one short question.

You can act on everything in the desk with your tools: calendar items (to-dos, events, meetings), alarms and countdowns, the time tracker, the notebook, project names and notes, the theme and sound, and which windows are open. Act when Sol asks you to do something, for example "add…", "move my 3pm to 5", "mark the invoice done", "set a timer till 4pm", "start tracking bazaar", "write a note…", "switch to light mode" or "open my notebook". When you propose a plan, offer to add it rather than adding it unasked. To change or delete something that already exists, use its id from the planner data, and never make up an id. If it isn't clear which thing Sol means, ask one short question instead of guessing. Only delete when Sol clearly asks. Only say you did something after the tool succeeded, and confirm it in one short line.

Alarms and the time tracker are different things. A timer that rings ("timer till 4pm", "25 minute timer", "remind me at 9", "wake me…") is set_alarm. Tracking how long Sol works on something ("start tracking", "clock in", "stop the timer" while tracking) is start_timer or stop_timer.

Format replies as plain text: short paragraphs, "- " bullets and **bold** for emphasis. No headings, tables or code blocks.`;

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

/** Today (in Sol's time zone) and the window of items the planner sees: 14 days back to 60 days ahead. */
export function plannerWindow(now = new Date(), tz = TIME_ZONE) {
  const z = zonedParts(now, tz);
  return { ...z, from: shiftDay(z.day, -14), to: shiftDay(z.day, 60) };
}

const oneLine = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** Time tracked in the last 7 days, per project, and any timer running now. */
function timeLines(entries: TimeEntry[], settings: Settings, now: Date, tz: string): string {
  const from = now.getTime() - 7 * 864e5;
  const recent = entries.filter((e) => !e.deletedAt && Date.parse(e.startedAt) >= from);
  const { total, byProject } = totals(recent, new Date(from), now.getTime());
  const run = recent.find((e) => !e.endedAt) ?? entries.find((e) => !e.endedAt && !e.deletedAt);
  const parts = [
    byProject.p1 && `${settings.p1.name} ${fmtDur(byProject.p1)}`,
    byProject.p2 && `${settings.p2.name} ${fmtDur(byProject.p2)}`,
    byProject.none && `no project ${fmtDur(byProject.none)}`,
  ].filter(Boolean);
  const runLine = run
    ? `\nTimer running now: "${oneLine(run.label, 100) || 'no label'}"${run.project ? ` (${settings[run.project].name})` : ''} since ${zonedParts(new Date(run.startedAt), tz).time}.`
    : '';
  return `Time tracked in the last 7 days: ${total ? `${fmtDur(total)} — ${parts.join(', ')}` : 'none yet'}.${runLine}`;
}

/** Alarms still to come (or ringing now), with ids so the planner can cancel them. */
function alarmLines(alarms: Alarm[], now: Date, tz: string): string {
  const today = zonedParts(now, tz).day;
  return alarms
    .filter((a) => !a.deletedAt && !a.dismissedAt && Date.parse(a.at) > now.getTime() - 60 * 60e3)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 30)
    .map((a) => {
      const z = zonedParts(new Date(a.at), tz);
      const when = z.day === today ? z.time : `${z.day} ${z.time}`;
      const state = Date.parse(a.at) <= now.getTime() ? ' (ringing now)' : '';
      return `- [${a.id}] ${when}${state}${a.label ? ' — ' + oneLine(a.label, 120) : ''}`;
    })
    .join('\n');
}

/** The planner data block sent with every message. Ids let the planner change or delete existing things. */
export function contextBlock(
  items: Item[],
  settings: Settings,
  now = new Date(),
  extra: { entries?: TimeEntry[]; notes?: Note[]; alarms?: Alarm[]; tz?: string } = {},
): string {
  const tz = extra.tz ?? TIME_ZONE;
  const w = plannerWindow(now, tz);
  const noteRows = (extra.notes ?? [])
    .slice(0, 10)
    .map((n) => `- [${n.id}] ${oneLine(n.title, 100) || 'Untitled'}: ${oneLine(n.body, 300) || '(empty)'}`);
  const pn = (p: Item['project']) => (p === 'p1' ? settings.p1.name : p === 'p2' ? settings.p2.name : '-');
  const proj = (k: 'p1' | 'p2') => {
    const s = settings[k];
    return `${k} = "${s.name}"${s.notes.trim() ? ` (notes: ${oneLine(s.notes, 600)})` : ''}`;
  };
  const rows = items
    .slice(0, 150)
    .map((x) =>
      [
        x.id,
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
Now: ${w.weekday} ${w.day} ${w.time} (Sol's time zone: ${tz}).
Projects: ${proj('p1')}; ${proj('p2')}. Theme: ${settings.theme}. Sound: ${settings.sound ? 'on' : 'off'}.
Items from ${w.from} to ${w.to}, plus undated ones and anything finished in the last 7 days
(id | type | date | time | minutes | project | status | title | details):
${rows.join('\n') || '(nothing planned yet)'}
${timeLines(extra.entries ?? [], settings, now, tz)}
Alarms and countdowns:
${alarmLines(extra.alarms ?? [], now, tz) || '(none set)'}
Notebook (most recently edited first):
${noteRows.join('\n') || '(no notes yet)'}
--- End of planner data ---`;
}

/** Server-side refusal fallback is available on these models (beta `server-side-fallback-2026-07-01`). */
export function fallbackParams(model: string): { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } | Record<string, never> {
  return /^claude-(sonnet-5-5|opus-5|opus-5-5|fable-5)/.test(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : {};
}
