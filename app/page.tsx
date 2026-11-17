import { cookies } from 'next/headers';
import { Desk, type DeskMode } from '@/components/Desk';
import { COOKIE, hasPassword, readSession, touchSession } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db/client';
import { getState } from '@/lib/server/repo';
import type { DeskState } from '@/lib/shared/types';

export const dynamic = 'force-dynamic';

/**
 * The only page. Without a valid, unlocked session the server renders the lock screen and
 * empty chrome only — no items, names or notes are in the HTML or the RSC payload.
 */
export default async function Page() {
  let mode: DeskMode = 'enter';
  let initial: DeskState | null = null;
  let detail: string | undefined;
  try {
    const db = await getDb();
    if (!(await hasPassword(db))) mode = 'set';
    else {
      const session = await readSession(db, (await cookies()).get(COOKIE)?.value);
      if (session?.state === 'active') {
        await touchSession(db, session);
        initial = await getState(db);
        mode = 'ok';
      }
    }
  } catch (e) {
    console.error('[page] could not load the desk', e);
    mode = 'offline';
    // While developing, say why on the lock screen. Never in production.
    if (process.env.NODE_ENV !== 'production') detail = e instanceof Error ? e.message : String(e);
  }
  return <Desk mode={mode} initial={initial} detail={detail} />;
}
