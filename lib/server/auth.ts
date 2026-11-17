import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, desc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import type { DB } from './db/client';
import { auth, loginAttempts, sessions } from './db/schema';

export const SESSION_DAYS = 30;
/** No activity for this long locks the session until the password is entered again. */
export const IDLE_MS = 30 * 60e3;
/** Heartbeats are throttled to one a minute, so give the server a little slack. */
const IDLE_GRACE_MS = 2 * 60e3;
export const MIN_PASSWORD = 8;

export const COOKIE = process.env.NODE_ENV === 'production' ? '__Host-sol' : 'sol';

// argon2id with OWASP-recommended cost (19 MiB, 2 passes).
const ARGON = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters.');
  return s;
}

/** Sessions are stored under an HMAC of the cookie token, so a leaked database can't be replayed. */
export const hashToken = (token: string) => createHmac('sha256', secret()).update(token).digest('hex');

// ---------------------------------------------------------------- password

export async function hasPassword(db: DB): Promise<boolean> {
  const [r] = await db.select({ id: auth.id }).from(auth).limit(1);
  return !!r;
}

/** First run only. Returns false if a password already exists (someone beat us to it). */
export async function setInitialPassword(db: DB, pw: string): Promise<boolean> {
  const passwordHash = await hash(pw, ARGON);
  const rows = await db.insert(auth).values({ id: 1, passwordHash }).onConflictDoNothing().returning({ id: auth.id });
  return rows.length === 1;
}

export async function verifyPassword(db: DB, pw: string): Promise<boolean> {
  const [r] = await db.select().from(auth).where(eq(auth.id, 1));
  if (!r) return false;
  try {
    return await verify(r.passwordHash, pw);
  } catch {
    return false;
  }
}

export async function changePassword(db: DB, pw: string) {
  const passwordHash = await hash(pw, ARGON);
  await db.update(auth).set({ passwordHash, updatedAt: sql`now()` }).where(eq(auth.id, 1));
}

/** Used by `npm run reset-password`: the next visit asks for a new password. */
export async function resetPassword(db: DB) {
  await db.delete(auth);
  await db.delete(sessions);
}

// ---------------------------------------------------------------- sessions

export interface SessionInfo {
  id: string;
  /** 'locked' = idle for 30 min or locked by hand; the password is needed again. */
  state: 'active' | 'locked';
  lastActiveAt: Date;
}

export async function createSession(db: DB, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await db.insert(sessions).values({
    id: hashToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 864e5),
    lastActiveAt: now,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  // Opportunistic clean-up of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  return token;
}

export async function readSession(db: DB, token: string | null | undefined): Promise<SessionInfo | null> {
  if (!token || token.length > 200) return null;
  const id = hashToken(token);
  const [r] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!r) return null;
  const now = Date.now();
  if (r.expiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  const idle = now - r.lastActiveAt.getTime() > IDLE_MS + IDLE_GRACE_MS;
  return { id, state: r.lockedAt || idle ? 'locked' : 'active', lastActiveAt: r.lastActiveAt };
}

/** Record user activity (keeps the 30-minute idle lock at bay). Throttled to one write per 30 s. */
export async function touchSession(db: DB, s: SessionInfo) {
  if (Date.now() - s.lastActiveAt.getTime() < 30e3) return;
  await db.update(sessions).set({ lastActiveAt: sql`now()` }).where(eq(sessions.id, s.id));
}

export async function lockSession(db: DB, id: string) {
  await db.update(sessions).set({ lockedAt: sql`now()` }).where(eq(sessions.id, id));
}

export async function deleteSession(db: DB, id: string) {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteOtherSessions(db: DB, keepId: string) {
  await db.delete(sessions).where(ne(sessions.id, keepId));
}

// ---------------------------------------------------------------- rate limiting

export const COOLDOWN_AFTER = 5;
export const COOLDOWN_MS = 30e3;
export const LOCKOUT_AFTER = 20;
export const LOCKOUT_MS = 15 * 60e3;

/**
 * Global (not per-IP) — there's one user, so failures from anywhere count.
 *  - every 5th wrong password in a row → 30 s cooldown
 *  - 20 wrong passwords within an hour → 15 min lockout
 * Returns seconds to wait, or 0.
 */
export async function retryAfter(db: DB, now = new Date()): Promise<number> {
  const hourAgo = new Date(now.getTime() - 3600e3);
  const fails = await db
    .select({ at: loginAttempts.at })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ok, false), gt(loginAttempts.at, hourAgo)))
    .orderBy(desc(loginAttempts.at));
  if (fails.length >= LOCKOUT_AFTER) {
    const until = fails[0].at.getTime() + LOCKOUT_MS;
    if (until > now.getTime()) return Math.ceil((until - now.getTime()) / 1000);
  }
  const recent = await db.select().from(loginAttempts).orderBy(desc(loginAttempts.at), desc(loginAttempts.id)).limit(100);
  let streak = 0;
  for (const a of recent) {
    if (a.ok) break;
    streak++;
  }
  if (streak > 0 && streak % COOLDOWN_AFTER === 0) {
    const until = recent[0].at.getTime() + COOLDOWN_MS;
    if (until > now.getTime()) return Math.ceil((until - now.getTime()) / 1000);
  }
  return 0;
}

/** Log every attempt with a timestamp and IP. */
export async function recordAttempt(db: DB, ip: string | null, ok: boolean) {
  await db.insert(loginAttempts).values({ ip, ok });
  if (!ok) await db.delete(loginAttempts).where(lt(loginAttempts.at, new Date(Date.now() - 30 * 864e5)));
  if (!ok) console.warn(`[auth] failed password attempt from ${ip ?? 'unknown'} at ${new Date().toISOString()}`);
}
