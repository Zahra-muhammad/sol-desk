import { handle, json, requireSession } from '@/lib/server/http';
import { ImportError, exportAll, importBackup } from '@/lib/server/repo';

export const dynamic = 'force-dynamic';

/** File → Download backup: everything as JSON. */
export const GET = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  const data = await exportAll(a.db);
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 1), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="sol-desk-backup-${day}.json"`,
      'cache-control': 'no-store',
    },
  });
});

/** File → Import backup. Accepts this app's backups and the prototype's "Copy all my data" JSON. */
export const POST = handle(async (req: Request) => {
  const a = await requireSession(req, { activity: true });
  if (a instanceof Response) return a;
  if (Number(req.headers.get('content-length') || 0) > 20_000_000) return json({ error: 'too large' }, 413);
  const raw = await req.json().catch(() => null);
  try {
    return json(await importBackup(a.db, raw));
  } catch (e) {
    if (e instanceof ImportError) return json({ error: e.message }, 400);
    throw e;
  }
});
