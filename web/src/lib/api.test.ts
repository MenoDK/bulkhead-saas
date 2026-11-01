import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, SessionStore, type Session } from './api';

const session = (access: string, refresh: string): Session => ({
  accessToken: access,
  refreshToken: refresh,
  expiresIn: 600,
  user: { id: 'u1', email: 'a@example.test', name: 'A' },
  tenant: { id: 't1', name: 'T', niche: 'general', plan: 'free', role: 'owner' },
  tenants: [],
});

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as unknown as typeof fetch;
  const store = new SessionStore();
  const client = new ApiClient({ fetchImpl, store, baseUrl: '/api' });
  return { client, store, calls };
}

describe('ApiClient', () => {
  it('sends the bearer token, the JSON body and the idempotency key', async () => {
    const { client, store, calls } = setup(() => json(201, { ok: true }));
    store.set(session('A1', 'R1'));
    await client.request('/invoices', { method: 'POST', body: { a: 1 }, idempotencyKey: 'key-1' });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer A1');
    expect(headers['Idempotency-Key']).toBe('key-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.init.body).toBe('{"a":1}');
  });

  it('turns the error envelope into an ApiError with code and request id', async () => {
    const { client } = setup(() =>
      json(409, { error: { code: 'VERSION_CONFLICT', message: 'stale', requestId: 'rq-9' } }),
    );
    const err = await client.request('/resources/x', { method: 'PATCH', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'VERSION_CONFLICT', requestId: 'rq-9' });
  });

  it('survives a non-JSON error body', async () => {
    const { client } = setup(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(client.request('/x')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('refreshes once on 401 and replays the request with the new token', async () => {
    const { client, store, calls } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, session('A2', 'R2'));
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer A2'
        ? json(200, { ok: 1 })
        : json(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } });
    });
    store.set(session('A1', 'R1'));
    await expect(client.request('/resources')).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual(['/api/resources', '/api/auth/refresh', '/api/resources']);
    expect(store.get()?.refreshToken).toBe('R2');
  });

  it('shares ONE refresh between parallel 401s (rotation would otherwise look like token reuse)', async () => {
    let refreshes = 0;
    const { client, store } = setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, session('A2', 'R2'));
      }
      return (init.headers as Record<string, string>).Authorization === 'Bearer A2'
        ? json(200, {})
        : json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
    });
    store.set(session('A1', 'R1'));
    await Promise.all([
      client.request('/a'),
      client.request('/b'),
      client.request('/c'),
      client.request('/d'),
    ]);
    expect(refreshes).toBe(1);
  });

  it('does not loop when the refresh itself is rejected: the session is cleared', async () => {
    const { client, store, calls } = setup((url) =>
      url.endsWith('/auth/refresh')
        ? json(401, { error: { code: 'UNAUTHORIZED', message: 'reuse' } })
        : json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );
    store.set(session('A1', 'R1'));
    await expect(client.request('/resources')).rejects.toMatchObject({ status: 401 });
    expect(store.get()).toBeNull();
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('a wrong password on /auth/login is reported, not "refreshed"', async () => {
    const { client, calls } = setup(() =>
      json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }),
    );
    await expect(client.login({ email: 'a@example.test', password: 'x' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(calls).toHaveLength(1);
  });

  it('keeps the refresh token across a network failure during refresh', async () => {
    const { client, store } = setup((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('network down');
      return json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
    });
    store.set(session('A1', 'R1'));
    await expect(client.request('/resources')).rejects.toBeInstanceOf(ApiError);
    expect(store.getRefreshToken()).toBe('R1');
  });

  it('bootstrap restores a session from the stored refresh token', async () => {
    const { client, store } = setup(() => json(200, session('A9', 'R9')));
    store.set(session('A1', 'R1'));
    store.set(null);
    window.sessionStorage.setItem('auth.refresh', 'R1');
    const restored = await client.bootstrap();
    expect(restored?.accessToken).toBe('A9');
  });

  it('bootstrap returns null when there is nothing to restore', async () => {
    const { client, calls } = setup(() => json(500));
    expect(await client.bootstrap()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('logout clears local state first, even if the server call fails', async () => {
    const { client, store } = setup(() => {
      throw new TypeError('offline');
    });
    store.set(session('A1', 'R1'));
    await client.logout();
    expect(store.get()).toBeNull();
    expect(window.sessionStorage.getItem('auth.refresh')).toBeNull();
  });

  it('204 resolves to undefined', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    await expect(client.request('/resources/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
