import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApi } from '../lib/ApiContext';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { WebhookEndpoint } from '../lib/types';
import { Dialog } from '../ui/Dialog';
import { Skeleton, SkeletonRows } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { Badge, Button, EmptyState, ErrorState, errorMessage, TextField } from '../ui/primitives';
import { useDeliveries, useEndpoints } from './queries';

export function WebhooksPage() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const endpoints = useEndpoints();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<WebhookEndpoint | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const ping = useMutation({
    mutationFn: (id: string) => api.request(`/webhook-endpoints/${id}/ping`, { method: 'POST' }),
    onSuccess: () => toast.notify('Test event queued. Check deliveries in a few seconds.', 'success'),
    onError: (e) => toast.notify(errorMessage(e), 'danger'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.request<void>(`/webhook-endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhook-endpoints'] }),
    onError: (e) => toast.notify(errorMessage(e), 'danger'),
  });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Webhooks</h1>
          <p className="muted">Signed, retried and delivered after the change is committed, never before.</p>
        </div>
        <Button onClick={() => setAdding(true)}>Add endpoint</Button>
      </header>
      <section className="card">
        {endpoints.isPending ? (
          <SkeletonRows rows={3} columns={3} />
        ) : endpoints.isError ? (
          <ErrorState error={endpoints.error} onRetry={() => void endpoints.refetch()} />
        ) : endpoints.data.length === 0 ? (
          <EmptyState
            title="No endpoints yet"
            action={<Button onClick={() => setAdding(true)}>Add the first endpoint</Button>}
          >
            Register an HTTPS URL and we will send it events, signed with a secret only you hold.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Webhook endpoints</caption>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {endpoints.data.map((e) => (
                  <tr key={e.id}>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>
                      {e.url}
                    </td>
                    <td>{formatDateTime(e.createdAt)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button
                          variant="ghost"
                          small
                          busy={ping.isPending && ping.variables === e.id}
                          onClick={() => ping.mutate(e.id)}
                        >
                          Send test
                        </Button>
                        <Button variant="ghost" small onClick={() => setInspecting(e.id)}>
                          Deliveries
                        </Button>
                        <Button
                          variant="danger"
                          small
                          onClick={() => {
                            if (window.confirm(`Remove ${e.url}?`)) remove.mutate(e.id);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {adding && (
        <AddEndpointDialog
          onClose={() => setAdding(false)}
          onCreated={(e) => {
            setAdding(false);
            setCreated(e);
          }}
        />
      )}
      {created && <SecretDialog endpoint={created} onClose={() => setCreated(null)} />}
      {inspecting && <DeliveriesDialog id={inspecting} onClose={() => setInspecting(null)} />}
    </>
  );
}

function AddEndpointDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (e: WebhookEndpoint) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [url, setUrl] = useState('https://');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.request<WebhookEndpoint>('/webhook-endpoints', { method: 'POST', body: { url: url.trim() } }),
    onSuccess: (endpoint) => {
      void qc.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      onCreated(endpoint);
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'UNSAFE_TARGET'
          ? 'That address points at a private or internal network, which is not allowed.'
          : errorMessage(e),
      ),
  });
  function submit(event: FormEvent): void {
    event.preventDefault();
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
    } catch {
      return setError('Enter a full URL such as https://example.com/hooks.');
    }
    setError(null);
    create.mutate();
  }
  return (
    <Dialog title="Add a webhook endpoint" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <TextField
          label="Endpoint URL"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={error}
          hint="Private and loopback addresses are refused to prevent server-side request forgery."
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending}>
            Create endpoint
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SecretDialog({ endpoint, onClose }: { endpoint: WebhookEndpoint; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Save your signing secret" onClose={onClose}>
      <p>
        This secret verifies that events really come from us. <strong>It is shown only once</strong> and
        cannot be recovered later.
      </p>
      <code className="card flat mono" style={{ wordBreak: 'break-all' }} data-testid="secret">
        {endpoint.secret}
      </code>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(endpoint.secret ?? '').then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button onClick={onClose}>I have stored it</Button>
      </div>
    </Dialog>
  );
}

function DeliveriesDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const deliveries = useDeliveries(id);
  return (
    <Dialog title="Recent deliveries" onClose={onClose}>
      {deliveries.isPending ? (
        <div className="stack">
          <Skeleton height="1.2rem" />
          <Skeleton height="1.2rem" width="70%" />
        </div>
      ) : deliveries.isError ? (
        <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
      ) : deliveries.data.length === 0 ? (
        <p className="muted">Nothing has been sent to this endpoint yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th className="num">Tries</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.topic}</td>
                  <td>
                    <Badge
                      tone={
                        d.status === 'delivered'
                          ? 'success'
                          : d.status === 'failed' || d.status === 'dead'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {d.status}
                    </Badge>
                    {d.lastError && <div className="muted">{d.lastError}</div>}
                  </td>
                  <td className="num">{d.attempts}</td>
                  <td>{formatDateTime(d.deliveredAt ?? d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
