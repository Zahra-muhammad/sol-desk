import { addD, iso, pad } from './dates';
import { uid } from './ids';
import type { Item, ItemType, ProjectKey } from './types';

const MEETING_WORDS = /\b(meet|meeting|call|zoom|sync|interview|standup)\b/i;
const WEEKDAY = /\b(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i;

/**
 * Plain-language quick add, ported from the prototype:
 *   "call Ali tomorrow 3pm #1" → meeting tomorrow 15:00 in project one
 *   "gym 7am"                  → event today 07:00
 *   "send invoice fri #2"      → to-do on Friday in project two
 */
export function quickAdd(text: string, now = new Date()): Item {
  let t = ' ' + text + ' ';
  let date = '';
  let time = '';
  let type: ItemType = 'task';
  let project: ProjectKey | null = null;

  // #1 / #2 / #p1 / #p2 — the "#" is required so "buy 1 milk" stays a plain to-do.
  if (/\s#p?1(?=\s)/i.test(t)) project = 'p1';
  if (/\s#p?2(?=\s)/i.test(t)) project = 'p2';
  t = t.replace(/\s#p?[12](?=\s)/gi, ' ');

  const rel: [RegExp, number][] = [
    [/\bday after tomorrow\b/i, 2],
    [/\btomorrow\b|\btmrw\b/i, 1],
    [/\btonight\b/i, 0],
    [/\btoday\b/i, 0],
  ];
  for (const [r, n] of rel) {
    if (r.test(t)) {
      date = iso(addD(now, n));
      t = t.replace(r, '');
      break;
    }
  }

  if (!date) {
    const m = t.match(WEEKDAY);
    if (m) {
      const di = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[2].slice(0, 3).toLowerCase());
      // Next occurrence (a week ahead if it's today); "next fri" skips one more week.
      let k = (di - now.getDay() + 7) % 7 || 7;
      if (m[1]) k += k < 7 ? 7 : 0;
      date = iso(addD(now, k));
      t = t.replace(m[0], '');
    }
  }

  if (!date) {
    // dd/mm or dd.mm — rolls into next year if it has already passed.
    const m = t.match(/\b(\d{1,2})[/.](\d{1,2})\b/);
    if (m) {
      const dd = +m[1];
      const mm = +m[2];
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const d = new Date(now.getFullYear(), mm - 1, dd);
        if (d < addD(now, -1)) d.setFullYear(d.getFullYear() + 1);
        date = iso(d);
        t = t.replace(m[0], '');
      }
    }
  }

  const tm = t.match(/\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at )?(\d{1,2}):(\d{2})\b/i);
  if (tm) {
    let h: number;
    let mi: number;
    if (tm[3]) {
      h = (+tm[1] % 12) + (tm[3].toLowerCase() === 'pm' ? 12 : 0);
      mi = +(tm[2] || 0);
    } else {
      h = +tm[4];
      mi = +tm[5];
    }
    if (h < 24 && mi < 60) {
      time = pad(h) + ':' + pad(mi);
      t = t.replace(tm[0], '');
    }
  }

  if (MEETING_WORDS.test(t)) type = 'meeting';
  else if (time) type = 'event';
  if (time && !date) date = iso(now);

  const stamp = now.toISOString();
  return {
    id: uid(),
    type,
    title: t.replace(/\s+/g, ' ').trim() || text.trim(),
    date: date || null,
    time: time || null,
    dur: type === 'task' ? 0 : type === 'meeting' ? 30 : 60,
    project,
    done: false,
    doneAt: null,
    month: false,
    with: '',
    link: '',
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}
