// npm run db:migrate — apply the SQL migrations in ./drizzle to DATABASE_URL.
// Runs automatically on Vercel (the `vercel-build` script) before `next build`.
import './env';
import { openDb } from '../lib/server/db/connect';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  const { close, kind } = await openDb(url, { migrate: true });
  await close();
  console.log(`Migrations applied (${kind}).`);
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
