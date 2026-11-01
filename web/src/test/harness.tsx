import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../App';
import { ApiClient, SessionStore, type Role, type Session } from '../lib/api';
import { ApiProvider } from '../lib/ApiContext';
import { ThemeProvider } from '../theme/ThemeProvider';
import type { Niche } from '../theme/tokens';
import { ToastProvider } from '../ui/Toast';

export const session = (role: Role = 'owner', niche: Niche = 'general'): Session => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 600,
  user: { id: 'user-1', email: 'ana@example.test', name: 'Ana Souza' },
  tenant: { id: 'tenant-1', name: 'Acme Studio', niche, plan: 'free', role },
  tenants: [],
});

export const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
type Handler = (call: RecordedCall) => Response | Promise<Response>;
/** A route is a handler, a ready-made Response, or a JSON body (`unknown` would erase the handler's contextual type). */
export type Routes = Record<string, Handler | Response | object>;

/** A tiny in-memory API: routes are matched on "METHOD /path" (query string ignored), anything unmatched is a loud 599. */
export function fakeApi(routes: Routes) {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/api/, ''),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    if (route === undefined)
      return json(599, { error: { code: 'UNMOCKED', message: `No mock for ${call.method} ${call.path}` } });
    if (typeof route === 'function') return (route as Handler)(call);
    if (route instanceof Response) return route.clone();
    return json(200, route);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export function renderApp(options: {
  routes: Routes;
  signedIn?: Session | null;
  at?: string;
  splashMinimumMs?: number;
  niche?: Niche;
}) {
  const { fetchImpl, calls } = fakeApi(options.routes);
  const store = new SessionStore();
  if (options.signedIn) store.set(options.signedIn);
  const client = new ApiClient({ fetchImpl, store });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <ThemeProvider initial={{ niche: options.niche ?? 'general', preference: 'light' }}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={client}>
          <ToastProvider durationMs={60_000}>
            <MemoryRouter initialEntries={[options.at ?? '/']}>
              <App splashMinimumMs={options.splashMinimumMs ?? 0} />
            </MemoryRouter>
          </ToastProvider>
        </ApiProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...view, calls, client, store };
}
