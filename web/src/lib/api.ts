import type { Niche } from '../theme/tokens';
import { readStored, writeStored } from './storage';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface TenantSummary {
  id: string;
  name: string;
  niche: Niche;
  plan: string;
  role: Role;
}
export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string };
  tenant: TenantSummary;
  tenants: TenantSummary[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const REFRESH_KEY = 'auth.refresh';

/**
 * The access token lives in memory only. The rotating refresh token sits in sessionStorage (tab-scoped, cleared when the tab closes).
 * An httpOnly cookie behind a BFF would be stronger against XSS; the trade-off is written down in docs/adr/0006.
 */
export class SessionStore {
  private session: Session | null = null;
  private listeners = new Set<() => void>();

  get = (): Session | null => this.session;
  getRefreshToken = (): string | null => this.session?.refreshToken ?? readStored('session', REFRESH_KEY);

  set(next: Session | null): void {
    this.session = next;
    writeStored('session', REFRESH_KEY, next?.refreshToken ?? null);
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Sent as Idempotency-Key so a retried money movement is applied once. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Internal: this call already followed a refresh, do not loop. */
  retried?: boolean;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  store?: SessionStore;
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export class ApiClient {
  readonly store: SessionStore;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** One refresh in flight at a time: refresh tokens rotate, so two parallel refreshes would look like token reuse and revoke the session. */
  private refreshing: Promise<boolean> | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api';
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.store = options.store ?? new SessionStore();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const session = this.store.get();
    const response = await this.send(path, options, session?.accessToken);

    if (response.status === 401 && !options.retried && !path.startsWith('/auth/')) {
      if (await this.refresh()) return this.request<T>(path, { ...options, retried: true });
      throw await toError(response);
    }
    if (!response.ok) throw await toError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Returns true when a new session is in place. Concurrent callers share the same attempt. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.store.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const response = await this.send('/auth/refresh', { method: 'POST', body: { refreshToken } });
      if (!response.ok) {
        this.store.set(null);
        return false;
      }
      this.store.set((await response.json()) as Session);
      return true;
    } catch {
      // Network failure is not proof the token is bad: keep it so a later attempt can still work.
      return false;
    }
  }

  private send(path: string, options: RequestOptions, accessToken?: string): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`, globalThis.location?.origin ?? 'http://localhost');
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    return this.fetchImpl(url.pathname + url.search, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  }

  // --- auth -------------------------------------------------------------------------------------------------------

  async login(input: { email: string; password: string; tenantId?: string }): Promise<Session> {
    const session = await this.request<Session>('/auth/login', { method: 'POST', body: input });
    this.store.set(session);
    return session;
  }

  async register(input: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
    niche: Niche;
  }): Promise<Session> {
    const session = await this.request<Session>('/auth/register', { method: 'POST', body: input });
    this.store.set(session);
    return session;
  }

  async logout(): Promise<void> {
    const refreshToken = this.store.getRefreshToken();
    this.store.set(null);
    if (!refreshToken) return;
    try {
      await this.send('/auth/logout', { method: 'POST', body: { refreshToken } });
    } catch {
      /* the local session is already gone; the server-side token expires on its own */
    }
  }

  /** On page load: turn a surviving refresh token back into a session, or report that there is none. */
  async bootstrap(): Promise<Session | null> {
    if (this.store.get()) return this.store.get();
    return (await this.refresh()) ? this.store.get() : null;
  }
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; requestId?: string; details?: Record<string, unknown> };
    };
    const e = payload.error;
    return new ApiError(
      response.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? `Request failed (${response.status})`,
      e?.requestId,
      e?.details,
    );
  } catch {
    return new ApiError(response.status, 'HTTP_ERROR', `Request failed (${response.status})`);
  }
}
