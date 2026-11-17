import { MIN_PASSWORD, changePassword, deleteOtherSessions, recordAttempt, retryAfter, verifyPassword } from '@/lib/server/auth';
import { clientIp, handle, json, requireSession } from '@/lib/server/http';
import { ChangePasswordIn } from '@/lib/server/validate';

/**
 * Change password. `{ current }` alone just checks it (step one on the lock screen);
 * `{ current, next }` changes it and signs out every other device.
 */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  const body = ChangePasswordIn.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'bad request' }, 400);

  const wait = await retryAfter(a.db);
  if (wait) return json({ error: 'too many attempts', retryAfter: wait }, 429, { 'retry-after': String(wait) });
  const ok = await verifyPassword(a.db, body.data.current);
  await recordAttempt(a.db, clientIp(req), ok);
  if (!ok) {
    const next = await retryAfter(a.db);
    return json({ error: 'wrong password', ...(next ? { retryAfter: next } : {}) }, 401);
  }
  if (body.data.next === undefined) return json({ ok: true });
  if (body.data.next.length < MIN_PASSWORD) return json({ error: `Use at least ${MIN_PASSWORD} characters.` }, 400);
  await changePassword(a.db, body.data.next);
  await deleteOtherSessions(a.db, a.session.id);
  return json({ ok: true });
});
