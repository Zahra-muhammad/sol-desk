import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { migrationsFolder, openDb, type DB } from './connect';

export type { DB };

const g = globalThis as unknown as { __solDb?: Promise<DB>; __solMigrations?: number };

/** How many migrations exist on disk — changes when a new one is added while `next dev` is running. */
function migrationCount(): number {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(migrationsFolder(), 'meta', '_journal.json'), 'utf8'));
    return Array.isArray(j.entries) ? j.entries.length : 0;
  } catch {
    return 0;
  }
}

/**
 * One shared connection per server instance (survives hot reloads in dev).
 * Embedded PGlite databases are migrated on start — and again if a new migration appears while the
 * dev server keeps running. Real Postgres is migrated by `npm run db:migrate` (run by `vercel-build`).
 */
export function getDb(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  const embedded = !!url?.startsWith('pglite:');

  if (g.__solDb && embedded) {
    const n = migrationCount();
    if (n !== g.__solMigrations) {
      g.__solMigrations = n;
      g.__solDb = g.__solDb.then(async (db) => {
        const { migrate } = await import('drizzle-orm/pglite/migrator');
        await migrate(db as never, { migrationsFolder: migrationsFolder() });
        return db;
      });
    }
  }

  if (!g.__solDb) {
    if (embedded) g.__solMigrations = migrationCount();
    g.__solDb = (url ? openDb(url, { migrate: embedded }) : Promise.reject(new Error('DATABASE_URL is not set. See .env.example.')))
      .then((x) => x.db)
      .catch((e) => {
        g.__solDb = undefined;
        throw e;
      });
  }
  return g.__solDb;
}
