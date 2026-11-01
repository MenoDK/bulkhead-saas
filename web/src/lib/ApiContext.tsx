import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ApiClient, Session } from './api';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}

export function useSession(): Session | null {
  const api = useApi();
  return useSyncExternalStore(api.store.subscribe, api.store.get);
}
