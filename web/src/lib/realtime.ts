import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ApiClient } from './api';
import { useApi, useSession } from './ApiContext';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/** Server event -> which cached lists are now stale. */
export const INVALIDATIONS: Record<string, readonly (readonly string[])[]> = {
  'resource.created': [['resources']],
  'resource.updated': [['resources']],
  'resource.deleted': [['resources']],
  'invoice.updated': [['invoices']],
};

export type SocketFactory = (
  url: string,
  options: Record<string, unknown>,
) => Pick<Socket, 'on' | 'off' | 'connect' | 'disconnect' | 'close'>;

const defaultFactory: SocketFactory = (url, options) => io(url, options);

/**
 * Connects once per signed-in session. The token is supplied by a callback so every (re)connect uses the CURRENT one,
 * and when the server cuts the socket because the access token expired we refresh and reconnect instead of staying silent.
 */
export function connectRealtime(
  api: ApiClient,
  queryClient: QueryClient,
  onStatus: (s: RealtimeStatus) => void,
  factory: SocketFactory = defaultFactory,
): () => void {
  const socket = factory('/', {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: (cb: (data: { token: string }) => void) => cb({ token: api.store.get()?.accessToken ?? '' }),
  });
  let closed = false;

  const reconnectWithFreshToken = async (): Promise<void> => {
    if (closed) return;
    onStatus('connecting');
    if (await api.refresh()) {
      if (!closed) socket.connect();
    } else if (!closed) {
      onStatus('offline');
    }
  };

  socket.on('connect', () => onStatus('live'));
  socket.on('disconnect', (reason: string) => {
    // "io server disconnect" = the server hung up (token expired); socket.io will not retry that on its own.
    if (reason === 'io server disconnect') void reconnectWithFreshToken();
    else onStatus('offline');
  });
  socket.on('error', (payload: { code?: string }) => {
    if (payload?.code === 'UNAUTHORIZED') void reconnectWithFreshToken();
  });
  for (const [event, keys] of Object.entries(INVALIDATIONS)) {
    socket.on(event, () => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: [...key] });
    });
  }
  return () => {
    closed = true;
    socket.close();
  };
}

export function useRealtime(): RealtimeStatus {
  const api = useApi();
  const queryClient = useQueryClient();
  const signedIn = useSession() !== null;
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    if (!signedIn) return;
    return connectRealtime(api, queryClient, setStatus);
  }, [api, queryClient, signedIn]);

  return signedIn ? status : 'offline';
}
