// Opening a database, shared by the app (via client.ts) and the CLI scripts.
// No `server-only` import here, so `tsx scripts/*.ts` can use it.
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsFolder = () => path.join(process.cwd(), 'drizzle');

/**
 *   postgres://…          → Postgres (Neon / Supabase) via postgres.js
 *   pglite:./.data/pglite → embedded Postgres in a folder (local dev, no server needed)
 *   pglite:memory         → in-memory (tests)
 */
export async function openDb(url: string, opts: { migrate?: boolean } = {}): Promise<{ db: DB; close: () => Promise<void>; kind: 'pglite' | 'postgres' }> {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const loc = url.slice('pglite:'.length);
    const client = loc === 'memory' || loc === '' ? new PGlite() : new PGlite(loc);
    const db = drizzle(client, { schema });
    if (opts.migrate) {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(db, { migrationsFolder: migrationsFolder() });
    }
    return { db: db as unknown as DB, close: () => client.close(), kind: 'pglite' };
  }

  const postgres = (await import('postgres')).default;
  const { drizzle } = await import('drizzle-orm/postgres-js');
  // prepare:false keeps us compatible with transaction-mode poolers (Neon / Supabase pooled URLs).
  const client = postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  if (opts.migrate) {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db, { migrationsFolder: migrationsFolder() });
  }
  return { db: db as unknown as DB, close: () => client.end(), kind: 'postgres' };
}
