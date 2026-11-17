import { createSession, deleteSession, hasPassword, readSession, recordAttempt, retryAfter, verifyPassword } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db/client';
import { clientIp, cookieToken, handle, json, sameOrigin, sessionCookie } from '@/lib/server/http';
import { PasswordIn } from '@/lib/server/validate';

/** Unlock. 5 wrong in a row → 30 s cooldown; 20 wrong in an hour → 15 min lockout. */
export const POST = handle(async (req: Request) => {
  if (!sameOrigin(req)) return json({ error: 'bad origin' }, 403);
  const body = PasswordIn.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'bad request' }, 400);
  const db = await getDb();
  if (!(await hasPassword(db))) return json({ error: 'No password has been set yet.' }, 409);

  const wait = await retryAfter(db);
  if (wait) return json({ error: 'too many attempts', retryAfter: wait }, 429, { 'retry-after': String(wait) });

  const ip = clientIp(req);
  const ok = await verifyPassword(db, body.data.password);
  await recordAttempt(db, ip, ok);
  if (!ok) {
    const next = await retryAfter(db);
    return json({ error: 'wrong password', ...(next ? { retryAfter: next } : {}) }, 401);
  }

  // Replace whatever session this browser had (e.g. an idle-locked one).
  const old = await readSession(db, cookieToken(req));
  if (old) await deleteSession(db, old.id);
  const token = await createSession(db, { ip, userAgent: req.headers.get('user-agent') });
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) });
});
