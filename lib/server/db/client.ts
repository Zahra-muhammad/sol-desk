import 'server-only';
import { openDb, type DB } from './connect';

export type { DB };

const g = globalThis as unknown as { __solDb?: Promise<DB> };

/**
 * One shared connection per server instance (survives hot reloads in dev).
 * Embedded PGlite databases are migrated on start; real Postgres is migrated by `npm run db:migrate`
 * (which runs automatically on Vercel via the `vercel-build` script).
 */
export function getDb(): Promise<DB> {
  if (!g.__solDb) {
    const url = process.env.DATABASE_URL;
    g.__solDb = (url ? openDb(url, { migrate: url.startsWith('pglite:') }) : Promise.reject(new Error('DATABASE_URL is not set. See .env.example.')))
      .then((x) => x.db)
      .catch((e) => {
        g.__solDb = undefined;
        throw e;
      });
  }
  return g.__solDb;
}
