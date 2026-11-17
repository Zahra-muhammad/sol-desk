// Calendar helpers. Days are local calendar days as YYYY-MM-DD strings, like the prototype.

export const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addD = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const TODAY = () => iso(new Date());

/** "today", "tomorrow", "yesterday" or "Fri 21 Nov". */
export function fmtD(s: string | null | undefined, now = new Date()): string {
  if (!s) return '';
  const d = parse(s);
  if (s === iso(now)) return 'today';
  if (s === iso(addD(now, 1))) return 'tomorrow';
  if (s === iso(addD(now, -1))) return 'yesterday';
  return DOW[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3);
}

/** Wall-clock parts in a given IANA time zone (the server runs in UTC; Sol lives in Dubai). */
export function zonedParts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: p.weekday as string,
  };
}

/** Shift a YYYY-MM-DD string by n days without touching time zones. */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
