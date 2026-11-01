import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApi, useSession } from '../lib/ApiContext';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { canModifyResource, canWrite, isAdmin } from '../lib/permissions';
import type { Resource } from '../lib/types';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES } from '../theme/tokens';
import { Dialog } from '../ui/Dialog';
import { SkeletonRows } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  errorMessage,
  TextAreaField,
  TextField,
} from '../ui/primitives';
import { useResources } from './queries';

type Filter = 'all' | 'active' | 'archived';

export function ResourcesPage() {
  const api = useApi();
  const session = useSession();
  const { niche } = useTheme();
  const v = THEMES[niche].vocabulary;
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  const list = useResources(filter === 'all' ? undefined : filter);
  const role = session?.tenant.role ?? 'viewer';
  const userId = session?.user.id ?? '';

  const conflictAware = (error: unknown): void => {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      toast.notify('Someone changed this at the same time. Showing the latest version.', 'danger');
      void qc.invalidateQueries({ queryKey: ['resources'] });
    } else toast.notify(errorMessage(error), 'danger');
  };

  const toggle = useMutation({
    mutationFn: (r: Resource) =>
      api.request<Resource>(`/resources/${r.id}`, {
        method: 'PATCH',
        body: { version: r.version, status: r.status === 'active' ? 'archived' : 'active' },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['resources'] }),
    onError: conflictAware,
  });
  const remove = useMutation({
    mutationFn: (r: Resource) => api.request<void>(`/resources/${r.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.notify(`${v.resource} deleted`, 'success');
      void qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: (e) => toast.notify(errorMessage(e), 'danger'),
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{v.resources}</h1>
          <p className="muted">Everything here is visible only to your workspace.</p>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Filter by status">
            {(['all', 'active', 'archived'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f[0]?.toUpperCase()}
                {f.slice(1)}
              </button>
            ))}
          </div>
          {canWrite(role) && (
            <Button onClick={() => setEditing('new')}>New {v.resource.toLowerCase()}</Button>
          )}
        </div>
      </header>

      <section className="card" aria-busy={list.isFetching}>
        {list.isPending ? (
          <SkeletonRows rows={6} columns={4} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={`No ${v.resources.toLowerCase()} yet`}
            action={
              canWrite(role) ? (
                <Button onClick={() => setEditing('new')}>Add the first one</Button>
              ) : undefined
            }
          >
            {canWrite(role)
              ? 'Create one and it appears here instantly, for everyone in the workspace.'
              : 'Ask an editor to add some.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{v.resources}</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const mine = canModifyResource(role, userId, r);
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        {typeof r.data.notes === 'string' && r.data.notes && (
                          <div className="muted">{r.data.notes}</div>
                        )}
                      </td>
                      <td>
                        <Badge tone={r.status === 'active' ? 'success' : undefined}>{r.status}</Badge>
                      </td>
                      <td>{formatDateTime(r.updatedAt)}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {mine && (
                            <Button variant="ghost" small onClick={() => setEditing(r)}>
                              Edit
                            </Button>
                          )}
                          {mine && (
                            <Button
                              variant="ghost"
                              small
                              busy={toggle.isPending && toggle.variables?.id === r.id}
                              onClick={() => toggle.mutate(r)}
                            >
                              {r.status === 'active' ? 'Archive' : 'Restore'}
                            </Button>
                          )}
                          {isAdmin(role) && (
                            <Button
                              variant="danger"
                              small
                              busy={remove.isPending && remove.variables?.id === r.id}
                              onClick={() => {
                                if (window.confirm(`Delete “${r.name}”? This cannot be undone.`))
                                  remove.mutate(r);
                              }}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
          <div className="row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <Button variant="ghost" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </section>

      {editing && (
        <ResourceDialog
          resource={editing === 'new' ? null : editing}
          label={v.resource}
          onClose={() => setEditing(null)}
          onConflict={conflictAware}
        />
      )}
    </>
  );
}

function ResourceDialog({
  resource,
  label,
  onClose,
  onConflict,
}: {
  resource: Resource | null;
  label: string;
  onClose: () => void;
  onConflict: (e: unknown) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(resource?.name ?? '');
  const [notes, setNotes] = useState(typeof resource?.data.notes === 'string' ? resource.data.notes : '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const data = { ...(resource?.data ?? {}), notes };
      return resource
        ? api.request<Resource>(`/resources/${resource.id}`, {
            method: 'PATCH',
            body: { version: resource.version, name: name.trim(), data },
          })
        : api.request<Resource>('/resources', { method: 'POST', body: { name: name.trim(), data } });
    },
    onSuccess: () => {
      toast.notify(`${label} saved`, 'success');
      void qc.invalidateQueries({ queryKey: ['resources'] });
      onClose();
    },
    onError: (e) => {
      onConflict(e);
      if (!(e instanceof ApiError && e.code === 'VERSION_CONFLICT')) return;
      onClose();
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return setError('A name is required.');
    setError(null);
    save.mutate();
  }

  return (
    <Dialog title={resource ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          maxLength={200}
        />
        <TextAreaField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={2000}
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
