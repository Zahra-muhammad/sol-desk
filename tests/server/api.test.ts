import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as backupRoute from '@/app/api/backup/route';
import * as chatClear from '@/app/api/chat/clear/route';
import * as heartbeat from '@/app/api/auth/heartbeat/route';
import * as lockRoute from '@/app/api/auth/lock/route';
import * as login from '@/app/api/auth/login/route';
import * as password from '@/app/api/auth/password/route';
import * as setup from '@/app/api/auth/setup/route';
import * as planner from '@/app/api/planner/route';
import * as stateRoute from '@/app/api/state/route';
import * as syncRoute from '@/app/api/sync/route';
import { LOCKOUT_AFTER, retryAfter } from '@/lib/server/auth';
import { getDb, type DB } from '@/lib/server/db/client';
import { auth, items, loginAttempts, sessions } from '@/lib/server/db/schema';
import { sessionCookie } from '@/lib/server/http';
import { makeItem } from '../helpers/fixtures';

const URL0 = 'http://localhost:3000';
const PW = '4821';
let db: DB;

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: 'localhost:3000', ...(init.headers || {}) };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(URL0 + path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const cookieOf = (r: Response) => (r.headers.get('set-cookie') || '').split(';')[0];

async function setUpPassword() {
  const r = await setup.POST(req('/api/auth/setup', { method: 'POST', body: { password: PW } }));
  expect(r.status).toBe(200);
  return cookieOf(r);
}

beforeAll(async () => {
  (globalThis as { __solDb?: unknown }).__solDb = undefined;
  db = await getDb();
});

beforeEach(async () => {
  await db.delete(auth);
  await db.delete(sessions);
  await db.delete(loginAttempts);
  await db.delete(items);
});

describe('nothing without a session', () => {
  const routes: [string, (r: Request) => Promise<Response>, string][] = [
    ['GET', stateRoute.GET, '/api/state'],
    ['GET', syncRoute.GET, '/api/sync?since=2020-01-01T00:00:00Z'],
    ['POST', syncRoute.POST, '/api/sync'],
    ['GET', backupRoute.GET, '/api/backup'],
    ['POST', backupRoute.POST, '/api/backup'],
    ['POST', chatClear.POST, '/api/chat/clear'],
    ['POST', planner.POST, '/api/planner'],
    ['POST', heartbeat.POST, '/api/auth/heartbeat'],
    ['POST', lockRoute.POST, '/api/auth/lock'],
    ['POST', password.POST, '/api/auth/password'],
  ];
  it.each(routes)('%s %s → 401', async (method, fn, path) => {
    await setUpPassword();
    const r = await fn(req(path, { method, body: method === 'POST' ? {} : undefined }));
    expect(r.status).toBe(401);
  });

  it('a made-up cookie is rejected too', async () => {
    await setUpPassword();
    const r = await stateRoute.GET(req('/api/state', { cookie: 'sol=not-a-real-token' }));
    expect(r.status).toBe(401);
  });
});

describe('password and sessions', () => {
  it('the password must be exactly 4 numbers', async () => {
    for (const bad of ['short', '123', '12345', 'abcd', '12a4', ' 1234']) {
      const r = await setup.POST(req('/api/auth/setup', { method: 'POST', body: { password: bad } }));
      expect(r.status, bad).toBe(400);
      expect((await r.json()).error).toBe('Use exactly 4 numbers.');
    }
    const ok = await setup.POST(req('/api/auth/setup', { method: 'POST', body: { password: '0042' } }));
    expect(ok.status).toBe(200);
  });

  it('changing the password also needs exactly 4 numbers', async () => {
    const cookie = await setUpPassword();
    const r = await password.POST(req('/api/auth/password', { method: 'POST', cookie, body: { current: PW, next: 'longer password' } }));
    expect(r.status).toBe(400);
  });

  it('first run sets the password once, then refuses', async () => {
    const short = await setup.POST(req('/api/auth/setup', { method: 'POST', body: { password: 'short' } }));
    expect(short.status).toBe(400);
    await setUpPassword();
    const again = await setup.POST(req('/api/auth/setup', { method: 'POST', body: { password: '9999' } }));
    expect(again.status).toBe(409);
  });

  it('stores only an argon2id hash', async () => {
    await setUpPassword();
    const [row] = await db.select().from(auth);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toContain(PW);
  });

  it('session cookie is httpOnly, SameSite=Strict, 30 days — and Secure in production', async () => {
    const r = await setup.POST(req('/api/auth/setup', { method: 'POST', body: { password: PW } }));
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Max-Age=2592000/);
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      expect(sessionCookie('x')).toMatch(/; Secure/);
    } finally {
      env.NODE_ENV = prev;
    }
  });

  it('only a hash of the session token is stored', async () => {
    const cookie = await setUpPassword();
    const token = cookie.split('=')[1];
    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(token);
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('login works with the right password and the cookie opens the API', async () => {
    await setUpPassword();
    const bad = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: 'nope nope' } }));
    expect(bad.status).toBe(401);
    const ok = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: PW } }));
    expect(ok.status).toBe(200);
    const st = await stateRoute.GET(req('/api/state', { cookie: cookieOf(ok) }));
    expect(st.status).toBe(200);
  });

  it('locking makes the session useless until the password is entered again', async () => {
    const cookie = await setUpPassword();
    expect((await lockRoute.POST(req('/api/auth/lock', { method: 'POST', cookie }))).status).toBe(200);
    const st = await stateRoute.GET(req('/api/state', { cookie }));
    expect(st.status).toBe(401);
    expect(await st.json()).toEqual({ error: 'locked' });
    const again = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: PW }, cookie }));
    expect((await stateRoute.GET(req('/api/state', { cookie: cookieOf(again) }))).status).toBe(200);
  });

  it('30 minutes idle locks the session on the server too', async () => {
    const cookie = await setUpPassword();
    await db.update(sessions).set({ lastActiveAt: new Date(Date.now() - 40 * 60e3) });
    expect((await stateRoute.GET(req('/api/state', { cookie }))).status).toBe(401);
  });

  it('expired sessions are rejected', async () => {
    const cookie = await setUpPassword();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await stateRoute.GET(req('/api/state', { cookie }))).status).toBe(401);
  });

  it('cross-site writes are refused', async () => {
    const cookie = await setUpPassword();
    const r = await syncRoute.POST(req('/api/sync', { method: 'POST', body: {}, cookie, headers: { origin: 'https://evil.example' } }));
    expect(r.status).toBe(403);
  });

  it('change password checks the current one and signs out other devices', async () => {
    const cookie = await setUpPassword();
    const other = cookieOf(await login.POST(req('/api/auth/login', { method: 'POST', body: { password: PW } })));
    const wrong = await password.POST(req('/api/auth/password', { method: 'POST', cookie, body: { current: 'not it at all', next: '7305' } }));
    expect(wrong.status).toBe(401);
    const check = await password.POST(req('/api/auth/password', { method: 'POST', cookie, body: { current: PW } }));
    expect(check.status).toBe(200);
    const change = await password.POST(req('/api/auth/password', { method: 'POST', cookie, body: { current: PW, next: '7305' } }));
    expect(change.status).toBe(200);
    expect((await stateRoute.GET(req('/api/state', { cookie: other }))).status).toBe(401);
    expect((await stateRoute.GET(req('/api/state', { cookie }))).status).toBe(200);
    const newLogin = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: '7305' } }));
    expect(newLogin.status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('5 wrong passwords → 30 s cooldown, even for the right one', async () => {
    await setUpPassword();
    for (let i = 1; i <= 4; i++) {
      const r = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: 'wrong ' + i } }));
      expect(r.status).toBe(401);
    }
    const fifth = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: 'wrong 5' } }));
    expect(fifth.status).toBe(401);
    expect((await fifth.json()).retryAfter).toBe(30);
    const blocked = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: PW } }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('logs failed attempts with time and IP', async () => {
    await setUpPassword();
    await login.POST(req('/api/auth/login', { method: 'POST', body: { password: 'wrong one' }, headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }));
    const [row] = await db.select().from(loginAttempts);
    expect(row).toMatchObject({ ok: false, ip: '203.0.113.7' });
    expect(row.at).toBeInstanceOf(Date);
  });

  it('20 wrong passwords in an hour → 15 minute lockout', async () => {
    await setUpPassword();
    const now = Date.now();
    // Spread out so no 30 s cooldown is active — only the hourly rule applies.
    for (let i = 0; i < LOCKOUT_AFTER; i++) {
      await db.insert(loginAttempts).values({ ok: false, ip: '1.2.3.4', at: new Date(now - (LOCKOUT_AFTER - i) * 60e3 - 7e3) });
    }
    await db.insert(loginAttempts).values({ ok: false, ip: '1.2.3.4', at: new Date(now - 1000) });
    const wait = await retryAfter(db, new Date(now));
    expect(wait).toBeGreaterThan(14 * 60);
    expect(wait).toBeLessThanOrEqual(15 * 60);
    const r = await login.POST(req('/api/auth/login', { method: 'POST', body: { password: PW } }));
    expect(r.status).toBe(429);
  });
});

describe('sync over HTTP', () => {
  it('push, then another device pulls the change and the delete', async () => {
    const cookie = await setUpPassword();
    const s0 = await (await stateRoute.GET(req('/api/state', { cookie }))).json();
    const a = makeItem({ title: 'from laptop' });
    const pushed = await syncRoute.POST(req('/api/sync', { method: 'POST', cookie, body: { items: [a], settings: { p1Name: '  Atlas  ' } } }));
    expect(pushed.status).toBe(200);
    const body = await pushed.json();
    expect(body.items[0].title).toBe('from laptop');
    expect(body.settings.p1.name).toBe('Atlas');

    const d1 = await (await syncRoute.GET(req('/api/sync?since=' + s0.cursor, { cookie }))).json();
    expect(d1.items.map((x: { id: string }) => x.id)).toContain(a.id);

    const t = new Date(Date.parse(a.updatedAt) + 1000).toISOString();
    await syncRoute.POST(req('/api/sync', { method: 'POST', cookie, body: { items: [{ ...a, deletedAt: t, updatedAt: t }] } }));
    const d2 = await (await syncRoute.GET(req('/api/sync?since=' + d1.cursor, { cookie }))).json();
    expect(d2.items.find((x: { id: string }) => x.id === a.id).deletedAt).toBe(t);
  });

  it('rejects a malformed push', async () => {
    const cookie = await setUpPassword();
    const r = await syncRoute.POST(req('/api/sync', { method: 'POST', cookie, body: { items: [{ id: 'no spaces allowed!' }] } }));
    expect(r.status).toBe(400);
  });

  it('download backup, then import it', async () => {
    const cookie = await setUpPassword();
    await syncRoute.POST(req('/api/sync', { method: 'POST', cookie, body: { items: [makeItem({ title: 'backed up' })] } }));
    const r = await backupRoute.GET(req('/api/backup', { cookie }));
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="sol-desk-backup-/);
    const backup = await r.json();
    await db.delete(items);
    const imp = await backupRoute.POST(req('/api/backup', { method: 'POST', cookie, body: backup }));
    expect(await imp.json()).toEqual({ items: 1, entries: 0, notes: 0, alarms: 0, skipped: 0 });
    const st = await (await stateRoute.GET(req('/api/state', { cookie }))).json();
    expect(st.items.map((x: { title: string }) => x.title)).toEqual(['backed up']);
  });

  it('the planner explains a missing API key instead of crashing', async () => {
    const cookie = await setUpPassword();
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await planner.POST(req('/api/planner', { method: 'POST', cookie, body: { message: 'Plan my day' } }));
      expect(r.status).toBe(503);
      expect((await r.json()).error).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
