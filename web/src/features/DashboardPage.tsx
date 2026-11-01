import { useMemo } from 'react';
import { useSession } from '../lib/ApiContext';
import { formatDateTime } from '../lib/format';
import { formatMinor } from '../lib/money';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES } from '../theme/tokens';
import { SkeletonCards, SkeletonRows } from '../ui/Skeleton';
import { Badge, ErrorState } from '../ui/primitives';
import { useInvoices, useResources } from './queries';

export function DashboardPage() {
  const session = useSession();
  const { niche } = useTheme();
  const v = THEMES[niche].vocabulary;
  const resources = useResources('active');
  const invoices = useInvoices();

  const totals = useMemo(() => {
    const byCurrency = new Map<string, { outstanding: number; collected: number }>();
    for (const page of invoices.data?.pages ?? []) {
      for (const inv of page.items) {
        const row = byCurrency.get(inv.currency) ?? { outstanding: 0, collected: 0 };
        if (inv.status === 'open') row.outstanding += inv.balanceCents;
        row.collected += inv.paidCents - inv.refundedCents;
        byCurrency.set(inv.currency, row);
      }
    }
    return [...byCurrency.entries()];
  }, [invoices.data]);

  const activeCount = resources.data?.pages.reduce((n, p) => n + p.items.length, 0) ?? 0;
  const moreActive = resources.data?.pages.at(-1)?.nextCursor != null;
  const recent = invoices.data?.pages[0]?.items.slice(0, 5) ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Good to see you, {session?.user.name.split(' ')[0]}</h1>
          <p className="muted">{THEMES[niche].tagline}</p>
        </div>
      </header>

      {resources.isPending || invoices.isPending ? (
        <SkeletonCards count={3} />
      ) : resources.isError || invoices.isError ? (
        <ErrorState
          error={resources.error ?? invoices.error}
          onRetry={() => {
            void resources.refetch();
            void invoices.refetch();
          }}
        />
      ) : (
        <section className="grid" aria-label="Key figures">
          <div className="card kpi">
            <span className="muted">Active {v.resources.toLowerCase()}</span>
            <span className="value">
              {activeCount}
              {moreActive ? '+' : ''}
            </span>
          </div>
          {totals.length === 0 && (
            <div className="card kpi">
              <span className="muted">{v.invoices} collected</span>
              <span className="value">—</span>
            </div>
          )}
          {totals.map(([currency, t]) => (
            <div className="card kpi" key={currency}>
              <span className="muted">Outstanding · {currency}</span>
              <span className="value">{formatMinor(t.outstanding, currency)}</span>
              <span className="muted">Collected {formatMinor(t.collected, currency)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card stack" aria-labelledby="recent">
        <h2 id="recent">Recent {v.invoices.toLowerCase()}</h2>
        {invoices.isPending ? (
          <SkeletonRows rows={4} columns={4} />
        ) : recent.length === 0 ? (
          <p className="muted">
            Nothing here yet. Create your first {v.invoice.toLowerCase()} from the {v.invoices} page.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((inv) => (
                  <tr key={inv.id}>
                    <td>{formatDateTime(inv.createdAt)}</td>
                    <td>
                      <Badge
                        tone={
                          inv.status === 'paid'
                            ? 'success'
                            : inv.status === 'void'
                              ? 'danger'
                              : inv.status === 'open'
                                ? 'brand'
                                : undefined
                        }
                      >
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="num">{formatMinor(inv.totalCents, inv.currency)}</td>
                    <td className="num">{formatMinor(inv.balanceCents, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
