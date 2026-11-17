import 'server-only';
import { COOKIE, SESSION_DAYS, readSession, touchSession, type SessionInfo } from './auth';
import { getDb, type DB } from './db/client';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const unauthorized = (error = 'unauthorized') => json({ error }, 401);

export function cookieToken(req: Request): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** httpOnly, Secure (in production), SameSite=Strict, 30 days. */
export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production';
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_DAYS * 86400}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearCookie(): string {
  const secure = process.env.NODE_ENV === 'production';
  return [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}

export function clientIp(req: Request): string | null {
  const f = req.headers.get('x-forwarded-for');
  if (f) return f.split(',')[0].trim().slice(0, 64);
  return req.headers.get('x-real-ip')?.slice(0, 64) ?? null;
}

/** Reject cross-site writes (belt and braces on top of SameSite=Strict). */
export function sameOrigin(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin fetches from older browsers / curl
  try {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Authed = { db: DB; session: SessionInfo };

/**
 * Every data route goes through this. No valid, unlocked session → 401, and nothing else happens.
 * `activity: true` counts the request as the user doing something (resets the idle timer).
 */
export async function requireSession(
  req: Request,
  opts: { activity?: boolean; allowLocked?: boolean } = {},
): Promise<Authed | Response> {
  if (!sameOrigin(req)) return json({ error: 'bad origin' }, 403);
  let db: DB;
  try {
    db = await getDb();
  } catch (e) {
    console.error('[db] connect failed', e);
    return json({ error: 'database unavailable' }, 503);
  }
  const session = await readSession(db, cookieToken(req));
  if (!session) return unauthorized();
  if (session.state === 'locked' && !opts.allowLocked) return unauthorized('locked');
  if (opts.activity && session.state === 'active') await touchSession(db, session);
  return { db, session };
}

/** Wrap a handler so a thrown error becomes a JSON 500 instead of an HTML page. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  };
}
