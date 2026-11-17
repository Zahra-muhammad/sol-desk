import { lockSession } from '@/lib/server/auth';
import { handle, json, requireSession } from '@/lib/server/http';

/** "Lock screen": the session stays, but nothing can be read until the password is entered again. */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { allowLocked: true });
  if (a instanceof Response) return a;
  await lockSession(a.db, a.session.id);
  return json({ ok: true });
});
