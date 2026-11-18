// npm run db:migrate — apply the SQL migrations in ./drizzle.
// Uses the direct connection (DATABASE_URL_UNPOOLED, as Neon provides) when set — recommended for
// schema changes — otherwise DATABASE_URL. Runs automatically on Vercel (`vercel-build`) before `next build`.
import './env';
import { openDb } from '../lib/server/db/connect';

const ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where we're connecting, without credentials — safe for build logs. */
function describe(url: string): string {
  if (url.startsWith('pglite:')) return 'embedded PGlite';
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^[^.]+/, '<endpoint>')}${u.hostname.includes('-pooler') ? ' (pooled)' : ' (direct)'}`;
  } catch {
    return 'an unparseable URL — check the value';
  }
}

async function main() {
  const which = process.env.DATABASE_URL_UNPOOLED ? 'DATABASE_URL_UNPOOLED' : process.env.DATABASE_URL ? 'DATABASE_URL' : null;
  if (!which) {
    console.error('Migration failed: neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. On Vercel, add it under Settings → Environment Variables.');
    process.exit(1);
  }
  const url = process.env[which]!;
  console.log(`Migrating via ${which} → ${describe(url)}`);

  // Neon may be waking from scale-to-zero during a build; retry a few times before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      const { close, kind } = await openDb(url, { migrate: true });
      await close();
      console.log(`Migrations applied (${kind}).`);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt >= ATTEMPTS) throw e;
      console.warn(`Attempt ${attempt} failed (${msg.replace(/postgres(ql)?:\/\/\S+/g, '<url>')}); retrying in ${attempt * 3}s…`);
      await sleep(attempt * 3000);
    }
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('Migration failed:', msg.replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exit(1);
});
