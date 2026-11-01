import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, useSession } from '../lib/ApiContext';
import { ApiError, newIdempotencyKey } from '../lib/api';
import { formatDateTime, shortId } from '../lib/format';
import { CURRENCIES, formatMinor, normaliseAmount, toDecimalString, toMinorUnits } from '../lib/money';
import { canWrite, isAdmin } from '../lib/permissions';
import type { Invoice } from '../lib/types';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES } from '../theme/tokens';
import { Dialog } from '../ui/Dialog';
import { Skeleton, SkeletonRows } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  errorMessage,
  SelectField,
  TextField,
} from '../ui/primitives';
import {
  describeTotal,
  draftTotal,
  emptyLine,
  toPayload,
  validateLine,
  type LineDraft,
  type LineErrors,
} from './invoiceForm';
import { useInvoice, useInvoices } from './queries';

const tone = (s: Invoice['status']) =>
  s === 'paid' ? 'success' : s === 'void' ? 'danger' : s === 'open' ? 'brand' : undefined;

const REASONS: Record<string, string> = {
  EXCEEDS_BALANCE: 'That is more than the remaining balance.',
  EXCEEDS_PAID: 'You cannot refund more than was paid.',
  REFUND_NEEDS_APPROVAL: 'Refunds this large need an admin or owner.',
  INVOICE_NOT_OPEN: 'This document is not open for payments.',
  DUPLICATE_PAYMENT: 'That payment was already recorded.',
  VERSION_CONFLICT: 'Someone else changed this. It has been refreshed.',
  IDEMPOTENCY_KEY_REUSED:
    'This request was already used with different details. Reopen the form and try again.',
};
export const explain = (e: unknown): string => (e instanceof ApiError && REASONS[e.code]) || errorMessage(e);

export function InvoicesPage() {
  const session = useSession();
  const { niche } = useTheme();
  const v = THEMES[niche].vocabulary;
  const list = useInvoices();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const role = session?.tenant.role ?? 'viewer';
  const open = params.get('open');
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{v.invoices}</h1>
          <p className="muted">Amounts are stored as whole minor units, so totals are always exact.</p>
        </div>
        {canWrite(role) && <Button onClick={() => setCreating(true)}>New {v.invoice.toLowerCase()}</Button>}
      </header>
      <section className="card" aria-busy={list.isFetching}>
        {list.isPending ? (
          <SkeletonRows rows={6} columns={5} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={`No ${v.invoices.toLowerCase()} yet`}
            action={
              canWrite(role) ? <Button onClick={() => setCreating(true)}>Create one</Button> : undefined
            }
          >
            Issued documents and their payments appear here.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{v.invoices}</caption>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono">{shortId(inv.id)}</td>
                    <td>{formatDateTime(inv.createdAt)}</td>
                    <td>
                      <Badge tone={tone(inv.status)}>{inv.status}</Badge>
                    </td>
                    <td className="num">{formatMinor(inv.totalCents, inv.currency)}</td>
                    <td className="num">{formatMinor(inv.balanceCents, inv.currency)}</td>
                    <td>
                      <Button variant="ghost" small onClick={() => setParams({ open: inv.id })}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
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
      {creating && <NewInvoiceDialog label={v.invoice} onClose={() => setCreating(false)} />}
      {open && <InvoiceDialog id={open} role={role} onClose={() => setParams({})} />}
    </>
  );
}

function NewInvoiceDialog({ label, onClose }: { label: string; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  // One key per opened form: a double click or a retry after a flaky network replays the SAME request instead of creating a second document.
  const key = useRef(newIdempotencyKey());
  const [currency, setCurrency] = useState<string>('USD');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [errors, setErrors] = useState<LineErrors[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.request<Invoice>('/invoices', {
        method: 'POST',
        body: toPayload(lines, currency),
        idempotencyKey: key.current,
      }),
    onSuccess: () => {
      toast.notify(`${label} created`, 'success');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      onClose();
    },
    onError: (e) => setFormError(explain(e)),
  });

  function update(index: number, patch: Partial<LineDraft>): void {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function submit(event: FormEvent): void {
    event.preventDefault();
    const found = lines.map((l) => validateLine(l, currency));
    setErrors(found);
    if (found.some((e) => Object.keys(e).length > 0) || draftTotal(lines, currency) === null) return;
    setFormError(null);
    create.mutate();
  }

  return (
    <Dialog title={`New ${label.toLowerCase()}`} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <SelectField
          label="Currency"
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value);
            setErrors([]);
          }}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        {lines.map((line, i) => (
          <fieldset key={i} className="card flat stack" style={{ gap: '.6rem' }}>
            <legend className="muted">Line {i + 1}</legend>
            <TextField
              label="Description"
              value={line.description}
              onChange={(e) => update(i, { description: e.target.value })}
              error={errors[i]?.description}
              maxLength={200}
            />
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 6rem' }}>
                <TextField
                  label="Quantity"
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                  error={errors[i]?.quantity}
                />
              </div>
              <div style={{ flex: '2 1 9rem' }}>
                <TextField
                  label="Unit price"
                  inputMode="decimal"
                  value={line.unit}
                  onChange={(e) => update(i, { unit: e.target.value })}
                  error={errors[i]?.unit}
                />
              </div>
            </div>
            {lines.length > 1 && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  small
                  onClick={() => setLines((c) => c.filter((_, j) => j !== i))}
                >
                  Remove line {i + 1}
                </Button>
              </div>
            )}
          </fieldset>
        ))}
        <div className="row between">
          <Button
            type="button"
            variant="ghost"
            small
            onClick={() => setLines((c) => [...c, emptyLine()])}
            disabled={lines.length >= 200}
          >
            Add line
          </Button>
          <strong>Total {describeTotal(lines, currency)}</strong>
        </div>
        {formError && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {formError}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending}>
            Create draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function InvoiceDialog({
  id,
  role,
  onClose,
}: {
  id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  onClose: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useInvoice(id);
  const inv = query.data;
  const [action, setAction] = useState<'pay' | 'refund' | null>(null);

  const transition = useMutation({
    mutationFn: (verb: 'issue' | 'void') =>
      api.request<Invoice>(`/invoices/${id}/${verb}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (e) => toast.notify(explain(e), 'danger'),
  });

  return (
    <Dialog title={inv ? `Document ${shortId(inv.id)}` : 'Loading document'} onClose={onClose}>
      {query.isPending ? (
        <div className="stack">
          <Skeleton height="1.4rem" width="50%" />
          <Skeleton height="6rem" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        inv && (
          <>
            <div className="row between">
              <Badge tone={tone(inv.status)}>{inv.status}</Badge>
              <span className="muted">{formatDateTime(inv.createdAt)}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit</th>
                    <th className="num">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(inv.lines ?? []).map((l) => (
                    <tr key={l.position}>
                      <td>{l.description}</td>
                      <td className="num">{l.quantity}</td>
                      <td className="num">{formatMinor(l.unitCents, inv.currency)}</td>
                      <td className="num">{formatMinor(l.unitCents * l.quantity, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="stack" style={{ gap: '.25rem', margin: 0 }}>
              <div className="row between">
                <dt>Total</dt>
                <dd style={{ margin: 0 }}>
                  <strong>{formatMinor(inv.totalCents, inv.currency)}</strong>
                </dd>
              </div>
              <div className="row between">
                <dt>Paid</dt>
                <dd style={{ margin: 0 }}>{formatMinor(inv.paidCents, inv.currency)}</dd>
              </div>
              <div className="row between">
                <dt>Refunded</dt>
                <dd style={{ margin: 0 }}>{formatMinor(inv.refundedCents, inv.currency)}</dd>
              </div>
              <div className="row between">
                <dt>Balance</dt>
                <dd style={{ margin: 0 }}>
                  <strong>{formatMinor(inv.balanceCents, inv.currency)}</strong>
                </dd>
              </div>
            </dl>
            {(inv.payments?.length ?? 0) > 0 && (
              <ul
                className="stack"
                style={{ gap: '.25rem', paddingLeft: '1.1rem', margin: 0 }}
                aria-label="Payment history"
              >
                {inv.payments?.map((p) => (
                  <li key={p.id}>
                    {p.kind === 'refund' ? 'Refund' : 'Payment'} {formatMinor(p.amountCents, inv.currency)}{' '}
                    <span className="muted">· {formatDateTime(p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite(role) && (
              <div className="row">
                {inv.status === 'draft' && (
                  <Button busy={transition.isPending} onClick={() => transition.mutate('issue')}>
                    Issue
                  </Button>
                )}
                {inv.status === 'open' && <Button onClick={() => setAction('pay')}>Record payment</Button>}
                {inv.paidCents - inv.refundedCents > 0 && inv.status !== 'void' && (
                  <Button variant="ghost" onClick={() => setAction('refund')}>
                    Refund
                  </Button>
                )}
                {isAdmin(role) && (inv.status === 'draft' || inv.status === 'open') && (
                  <Button
                    variant="danger"
                    busy={transition.isPending}
                    onClick={() => {
                      if (window.confirm('Void this document?')) transition.mutate('void');
                    }}
                  >
                    Void
                  </Button>
                )}
              </div>
            )}
            {action && <MoneyForm kind={action} invoice={inv} onDone={() => setAction(null)} />}
          </>
        )
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}

export function MoneyForm({
  kind,
  invoice,
  onDone,
}: {
  kind: 'pay' | 'refund';
  invoice: Invoice;
  onDone: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const key = useRef(newIdempotencyKey());
  const limit = kind === 'pay' ? invoice.balanceCents : invoice.paidCents - invoice.refundedCents;
  const [amount, setAmount] = useState(limit > 0 ? toDecimalString(limit, invoice.currency) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (canonical: string) =>
      api.request(`/invoices/${invoice.id}/${kind === 'pay' ? 'payments' : 'refunds'}`, {
        method: 'POST',
        body:
          kind === 'pay'
            ? { amount: canonical }
            : { amount: canonical, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        idempotencyKey: key.current,
      }),
    onSuccess: () => {
      toast.notify(kind === 'pay' ? 'Payment recorded' : 'Refund recorded', 'success');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      onDone();
    },
    onError: (e) => {
      setError(explain(e));
      if (e instanceof ApiError && e.code === 'IDEMPOTENCY_KEY_REUSED') key.current = newIdempotencyKey();
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    const canonical = normaliseAmount(amount, invoice.currency);
    if (canonical === null) return setError('Enter a valid amount.');
    const minor = toMinorUnits(canonical, invoice.currency);
    if (minor <= 0) return setError('The amount must be above zero.');
    if (minor > limit)
      return setError(
        kind === 'pay' ? 'That is more than the remaining balance.' : 'You cannot refund more than was paid.',
      );
    setError(null);
    send.mutate(canonical);
  }

  return (
    <form
      className="card flat stack"
      onSubmit={submit}
      noValidate
      aria-label={kind === 'pay' ? 'Record payment' : 'Refund'}
    >
      <TextField
        label={kind === 'pay' ? 'Payment amount' : 'Refund amount'}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={error}
        hint={`Up to ${formatMinor(limit, invoice.currency)}`}
      />
      {kind === 'refund' && (
        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
        />
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" busy={send.isPending}>
          {kind === 'pay' ? 'Record payment' : 'Refund'}
        </Button>
      </div>
    </form>
  );
}
