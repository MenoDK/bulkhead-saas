import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi, useSession } from '../lib/ApiContext';
import { formatDateTime, shortHash, shortId } from '../lib/format';
import { SkeletonRows } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { Badge, Button, EmptyState, ErrorState, errorMessage } from '../ui/primitives';
import { useAudit, useAuditVerdict } from './queries';

export function AuditPage() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useSession();
  const isOwner = session?.tenant.role === 'owner';
  const audit = useAudit(true);
  const verdict = useAuditVerdict();
  const [exporting, setExporting] = useState(false);
  const entries = audit.data?.pages.flatMap((p) => p.items) ?? [];

  async function exportSigned(): Promise<void> {
    setExporting(true);
    try {
      const body = await api.request<unknown>('/audit/export', { query: { limit: 1000 } });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit-export.signed.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.notify(errorMessage(error), 'danger');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Audit trail</h1>
          <p className="muted">
            Every entry commits to the one before it. Altering or removing history breaks the chain.
          </p>
        </div>
        <div className="row">
          <Button variant="ghost" busy={verdict.isFetching} onClick={() => void verdict.refetch()}>
            Verify chain
          </Button>
          {isOwner && (
            <Button variant="ghost" busy={exporting} onClick={() => void exportSigned()}>
              Export signed
            </Button>
          )}
          <Button variant="ghost" onClick={() => void qc.invalidateQueries({ queryKey: ['audit'] })}>
            Refresh
          </Button>
        </div>
      </header>

      {verdict.data && (
        <div
          className="card flat"
          role="status"
          style={{ borderColor: verdict.data.valid ? 'var(--success)' : 'var(--danger)' }}
        >
          {verdict.data.valid ? (
            <>
              <strong style={{ color: 'var(--success)' }}>Chain intact.</strong> {verdict.data.checked}{' '}
              entries verified.
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--danger)' }}>Chain broken</strong> at entry{' '}
              {verdict.data.broken?.seq} ({verdict.data.broken?.reason.replace(/_/g, ' ')}).
            </>
          )}
        </div>
      )}
      {verdict.isError && <ErrorState error={verdict.error} />}

      <section className="card" aria-busy={audit.isFetching}>
        {audit.isPending ? (
          <SkeletonRows rows={8} columns={5} />
        ) : audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState title="No activity recorded yet">
            Actions in this workspace will be listed here.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Audit entries, newest first</caption>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>When</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num mono">{e.seq}</td>
                    <td>{formatDateTime(e.createdAt)}</td>
                    <td>
                      <Badge tone="brand">{e.action}</Badge>
                    </td>
                    <td>
                      {e.entityType}
                      {e.entityId && <span className="muted mono"> {shortId(e.entityId)}</span>}
                    </td>
                    <td className="mono">{e.actorId ? shortId(e.actorId) : 'system'}</td>
                    <td className="mono" title={e.hash}>
                      {shortHash(e.hash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {audit.hasNextPage && (
          <div className="row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <Button
              variant="ghost"
              busy={audit.isFetchingNextPage}
              onClick={() => void audit.fetchNextPage()}
            >
              Older entries
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
