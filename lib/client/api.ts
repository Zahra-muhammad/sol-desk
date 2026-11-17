import type { Result } from './sync';
import type { DeskDelta, DeskState, PushBody, PushResult } from '@/lib/shared/types';

export async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  try {
    const r = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: body?.error, retryAfter: body?.retryAfter };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  state: () => call<DeskState>('/api/state'),
  pull: (since: string) => call<DeskDelta>('/api/sync?since=' + encodeURIComponent(since)),
  push: (body: PushBody) => post<PushResult>('/api/sync', body),
  beacon(body: PushBody) {
    try {
      void fetch('/api/sync', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
      });
    } catch {
      /* best effort */
    }
  },
};
