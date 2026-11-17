import { handle, json, requireSession } from '@/lib/server/http';
import { clearChat } from '@/lib/server/repo';

export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  await clearChat(a.db);
  return json({ ok: true });
});
