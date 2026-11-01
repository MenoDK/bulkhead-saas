import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../lib/ApiContext';
import type {
  AuditPage,
  AuditVerdict,
  Delivery,
  Invoice,
  Member,
  Page,
  Resource,
  WebhookEndpoint,
} from '../lib/types';

/** Server state lives in React Query; realtime events just invalidate these keys (see lib/realtime.ts). */

export function useResources(status?: 'active' | 'archived') {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['resources', status ?? 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.request<Page<Resource>>('/resources', { query: { limit: 25, cursor: pageParam, status } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInvoices() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['invoices', 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.request<Page<Invoice>>('/invoices', { query: { limit: 25, cursor: pageParam } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInvoice(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['invoices', 'one', id],
    enabled: id !== null,
    queryFn: () => api.request<Invoice>(`/invoices/${id}`),
  });
}

export function useMembers() {
  const api = useApi();
  return useQuery({ queryKey: ['members'], queryFn: () => api.request<Member[]>('/members') });
}

export function useAudit(enabled: boolean) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['audit'],
    enabled,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.request<AuditPage>('/audit', { query: { limit: 25, before: pageParam } }),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}

export function useAuditVerdict() {
  const api = useApi();
  return useQuery({
    queryKey: ['audit', 'verify'],
    enabled: false,
    queryFn: () => api.request<AuditVerdict>('/audit/verify'),
  });
}

export function useEndpoints() {
  const api = useApi();
  return useQuery({
    queryKey: ['webhook-endpoints'],
    queryFn: () => api.request<WebhookEndpoint[]>('/webhook-endpoints'),
  });
}

export function useDeliveries(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['webhook-endpoints', id, 'deliveries'],
    enabled: id !== null,
    queryFn: () => api.request<Delivery[]>(`/webhook-endpoints/${id}/deliveries`),
  });
}
