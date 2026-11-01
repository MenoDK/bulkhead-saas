import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, SessionStore, type Session } from './api';
import { connectRealtime, type RealtimeStatus, type SocketFactory } from './realtime';

class FakeSocket {
  handlers = new Map<string, ((...a: never[]) => void)[]>();
  connect = vi.fn();
  disconnect = vi.fn();
  close = vi.fn();
  on = (event: string, fn: (...a: never[]) => void) => {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this as never;
  };
  off = vi.fn();
  emit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
  }
}

const session = (a: string, r: string): Session => ({
  accessToken: a,
  refreshToken: r,
  expiresIn: 600,
  user: { id: 'u', email: 'a@example.test', name: 'A' },
  tenant: { id: 't', name: 'T', niche: 'general', plan: 'free', role: 'owner' },
  tenants: [],
});

function setup(refreshOk = true) {
  const store = new SessionStore();
  store.set(session('A1', 'R1'));
  const fetchImpl = (async () =>
    refreshOk
      ? new Response(JSON.stringify(session('A2', 'R2')), { status: 200 })
      : new Response('{}', { status: 401 })) as typeof fetch;
  const api = new ApiClient({ store, fetchImpl });
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const socket = new FakeSocket();
  let options: Record<string, unknown> = {};
  const factory: SocketFactory = (_u, o) => {
    options = o;
    return socket as never;
  };
  const statuses: RealtimeStatus[] = [];
  const stop = connectRealtime(api, qc, (s) => statuses.push(s), factory);
  return { api, socket, spy, statuses, stop, options: () => options, store };
}

describe('connectRealtime', () => {
  it('hands the CURRENT access token to every (re)connect attempt', () => {
    const { options, store } = setup();
    const auth = options().auth as (cb: (d: { token: string }) => void) => void;
    let seen = '';
    auth((d) => (seen = d.token));
    expect(seen).toBe('A1');
    store.set(session('A5', 'R5'));
    auth((d) => (seen = d.token));
    expect(seen).toBe('A5');
  });

  it('invalidates exactly the lists a server event makes stale', () => {
    const { socket, spy } = setup();
    socket.emit('invoice.updated', {});
    expect(spy).toHaveBeenCalledWith({ queryKey: ['invoices'] });
    spy.mockClear();
    socket.emit('resource.created', {});
    expect(spy).toHaveBeenCalledWith({ queryKey: ['resources'] });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reports live / offline', () => {
    const { socket, statuses } = setup();
    socket.emit('connect');
    socket.emit('disconnect', 'transport close');
    expect(statuses).toEqual(['live', 'offline']);
  });

  it('refreshes and reconnects when the server hangs up because the token expired', async () => {
    const { socket, statuses } = setup(true);
    socket.emit('disconnect', 'io server disconnect');
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(statuses).toContain('connecting');
  });

  it('gives up quietly (offline) when the refresh is refused', async () => {
    const { socket, statuses } = setup(false);
    socket.emit('error', { code: 'UNAUTHORIZED' });
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('offline'));
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('does not reconnect after cleanup', async () => {
    const { socket, stop } = setup(true);
    stop();
    socket.emit('disconnect', 'io server disconnect');
    await new Promise((r) => setTimeout(r, 20));
    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalled();
  });
});
