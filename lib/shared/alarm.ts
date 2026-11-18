// Alarms & countdowns: parse "4pm" / "25 min" / "tomorrow 9am gym", countdown text, ringing rules.
import { addD, iso, pad } from './dates';
import type { Alarm } from './types';

/** Ring alarms that came due while the desk was closed only if they're this recent; older ones show as missed. */
export const RING_WINDOW_MS = 60 * 60e3;
export const SNOOZE_MS = 5 * 60e3;

const DUR = /\b(?:in\s+)?(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?\b/i;

/**
 * "4pm", "16:30", "at 7am", "tomorrow 9am", "fri 8:15am" → that time (next occurrence);
 * "25 min", "in 1h 30m", "90 minutes", "2 hours" → now + duration.
 * Whatever text is left becomes the label. Returns null if no time was found.
 */
export function parseAlarm(text: string, now = new Date()): { label: string; at: Date } | null {
  let t = ' ' + text + ' ';

  // Duration first ("in 25 min", "1h 30m").
  const d = t.match(DUR);
  if (d && (d[1] || d[2])) {
    const ms = (parseFloat(d[1] || '0') * 60 + parseInt(d[2] || '0', 10)) * 60e3;
    if (ms > 0) {
      t = t.replace(d[0], ' ');
      return { label: cleanLabel(t.replace(/\b(timer|countdown|for|of)\b/gi, ' ')), at: new Date(now.getTime() + ms) };
    }
  }

  // Clock time, optionally with a day.
  const tm = t.match(/\b(?:at\s+|till\s+|until\s+|for\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s+|till\s+|until\s+|for\s+)?(\d{1,2}):(\d{2})\b/i);
  if (!tm) return null;
  let h: number;
  let mi: number;
  if (tm[3]) {
    h = (+tm[1] % 12) + (tm[3].toLowerCase() === 'pm' ? 12 : 0);
    mi = +(tm[2] || 0);
  } else {
    h = +tm[4];
    mi = +tm[5];
  }
  if (h > 23 || mi > 59) return null;
  t = t.replace(tm[0], ' ');

  let day: Date | null = null;
  if (/\bday after tomorrow\b/i.test(t)) {
    day = addD(now, 2);
    t = t.replace(/\bday after tomorrow\b/i, ' ');
  } else if (/\btomorrow\b|\btmrw\b/i.test(t)) {
    day = addD(now, 1);
    t = t.replace(/\btomorrow\b|\btmrw\b/i, ' ');
  } else if (/\btoday\b|\btonight\b/i.test(t)) {
    day = now;
    t = t.replace(/\btoday\b|\btonight\b/i, ' ');
  } else {
    const w = t.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i);
    if (w) {
      const di = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w[1].slice(0, 3).toLowerCase());
      day = addD(now, (di - now.getDay() + 7) % 7);
      t = t.replace(w[0], ' ');
    }
  }
  const base = day ?? now;
  let at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mi, 0, 0);
  // A time that already passed today means the next one.
  if (at.getTime() <= now.getTime()) at = new Date(at.getTime() + (day && iso(day) !== iso(now) ? 7 : 1) * 864e5);
  return { label: cleanLabel(t.replace(/\b(timer|alarm|remind me|reminder|set|an?)\b/gi, ' ')), at };
}

const cleanLabel = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,–—-]+|[\s,–—-]+$/g, '')
    .trim();

/** "in 1h 20m", "in 4m", "in 30s", "now". */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${pad(m % 60)}m`;
}

/** "16:00", or "Fri 16:00" when it isn't today. */
export function fmtAlarmTime(at: string, now = new Date()): string {
  const d = new Date(at);
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (iso(d) === iso(now)) return hm;
  if (iso(d) === iso(addD(now, 1))) return 'tomorrow ' + hm;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm;
}

/** Alarms that should be ringing right now. */
export const ringing = (alarms: Alarm[], now = Date.now()) =>
  alarms
    .filter((a) => !a.deletedAt && !a.dismissedAt && Date.parse(a.at) <= now && now - Date.parse(a.at) < RING_WINDOW_MS)
    .sort((a, b) => a.at.localeCompare(b.at));

export const upcoming = (alarms: Alarm[], now = Date.now()) =>
  alarms.filter((a) => !a.deletedAt && !a.dismissedAt && Date.parse(a.at) > now).sort((a, b) => a.at.localeCompare(b.at));

/** Came due while nobody was looking (more than an hour ago) and never dismissed. */
export const missed = (alarms: Alarm[], now = Date.now()) =>
  alarms.filter((a) => !a.deletedAt && !a.dismissedAt && now - Date.parse(a.at) >= RING_WINDOW_MS);

/**
 * Wall-clock time in an IANA zone → exact instant. Used by the planner, which runs on a UTC server:
 * "16:00 today in Asia/Dubai" → 12:00Z.
 */
export function zonedToUtc(day: string, hm: string, timeZone: string): Date {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (ts: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(ts))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts); // second pass settles DST edges
  return new Date(ts);
}

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
