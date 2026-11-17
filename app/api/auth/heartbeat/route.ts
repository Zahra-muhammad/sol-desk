import { handle, json, requireSession } from '@/lib/server/http';

/** The user is active (typing, clicking) — keeps the 30-minute idle lock at bay. */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  return json({ ok: true });
});
