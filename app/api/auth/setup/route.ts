import { PASSWORD_RULE, createSession, hasPassword, isValidPassword, setInitialPassword } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db/client';
import { clientIp, handle, json, sameOrigin, sessionCookie } from '@/lib/server/http';
import { PasswordIn } from '@/lib/server/validate';

/** First run: choose the password. Only works while no password exists. */
export const POST = handle(async (req: Request) => {
  if (!sameOrigin(req)) return json({ error: 'bad origin' }, 403);
  const body = PasswordIn.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: 'bad request' }, 400);
  if (!isValidPassword(body.data.password)) return json({ error: PASSWORD_RULE }, 400);
  const db = await getDb();
  if (await hasPassword(db)) return json({ error: 'A password is already set.' }, 409);
  if (!(await setInitialPassword(db, body.data.password))) return json({ error: 'A password is already set.' }, 409);
  const token = await createSession(db, { ip: clientIp(req), userAgent: req.headers.get('user-agent') });
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) });
});
