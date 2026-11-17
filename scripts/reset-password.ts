// npm run reset-password — forget the desk password and sign out every device.
// The next visit shows "Choose a password". Your plans are not touched.
import './env';
import { openDb } from '../lib/server/db/connect';
import { auth, sessions } from '../lib/server/db/schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Point it at the same database the desk uses.');
    process.exit(1);
  }
  const { db, close, kind } = await openDb(url, { migrate: url.startsWith('pglite:') });
  const removed = await db.delete(auth).returning({ id: auth.id });
  await db.delete(sessions);
  await close();
  console.log(
    removed.length
      ? `Password reset (${kind}). Every device is signed out; the next visit will ask you to choose a new password.`
      : `No password was set (${kind}). The next visit will ask you to choose one.`,
  );
}

main().catch((e) => {
  console.error('Reset failed:', e);
  process.exit(1);
});
