import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { decodeCursor, type Page, toPage } from '../../common/pagination';
import { ENV, type Env } from '../../config/env';
import { DatabaseService, type Tx } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { type IdempotentResult, IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxService } from '../outbox/outbox.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Money } from './money';
import { refundNeedsApproval } from './refund-policy';

export interface InvoiceView {
  id: string;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void';
  total: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  balanceCents: number;
  version: number;
  createdAt: string;
  lines?: { position: number; description: string; quantity: number; unitCents: number }[];
  payments?: {
    id: string;
    kind: 'payment' | 'refund';
    amountCents: number;
    provider: string | null;
    createdAt: string;
  }[];
}

interface InvoiceRow {
  id: string;
  currency: string;
  status: InvoiceView['status'];
  total_cents: string;
  paid_cents: string;
  refunded_cents: string;
  version: number;
  created_at: Date;
}

const COLUMNS = 'id, currency, status, total_cents, paid_cents, refunded_cents, version, created_at';
const RETURNING = COLUMNS;

const toView = (r: InvoiceRow): InvoiceView => ({
  id: r.id,
  currency: r.currency,
  status: r.status,
  total: Money.fromCents(r.total_cents, r.currency).toString(),
  totalCents: Number(r.total_cents),
  paidCents: Number(r.paid_cents),
  refundedCents: Number(r.refunded_cents),
  balanceCents: Number(r.total_cents) - Number(r.paid_cents),
  version: r.version,
  createdAt: r.created_at.toISOString(),
});

export type Rejection =
  'not_found' | 'not_open' | 'exceeds_balance' | 'exceeds_paid' | 'duplicate_provider_ref';
class Rejected extends Error {
  constructor(readonly reason: Rejection) {
    super(reason);
  }
}

export type MoneyMovement =
  { ok: true; invoice: InvoiceView; paymentId: string } | { ok: false; reason: Rejection };

const rejectionToError = (reason: Rejection) => {
  switch (reason) {
    case 'not_found':
      return notFound('Invoice');
    case 'not_open':
      return conflict('INVOICE_NOT_OPEN', 'Only open invoices accept payments');
    case 'exceeds_balance':
      return unprocessable('EXCEEDS_BALANCE', 'The amount is larger than the remaining balance');
    case 'exceeds_paid':
      return unprocessable('EXCEEDS_PAID', 'Cannot refund more than was paid');
    case 'duplicate_provider_ref':
      return conflict('DUPLICATE_PAYMENT', 'This provider payment was already recorded');
  }
};

export interface LineInput {
  description: string;
  quantity: number;
  unitPrice: string;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async createInvoice(
    user: AuthUser,
    input: { currency: string; lines: LineInput[] },
    key: string,
  ): Promise<IdempotentResult<InvoiceView>> {
    // Parse and total OUTSIDE the transaction: pure arithmetic on integers, and validation errors need no rollback.
    const priced = input.lines.map((l, position) => {
      const unit = Money.parse(l.unitPrice, input.currency);
      return { ...l, position, unitCents: unit.cents, subtotal: unit.times(l.quantity) };
    });
    const total = priced.reduce((sum, l) => sum.add(l.subtotal), Money.zero(input.currency));

    const result = await this.db.withTenant(user.tenantId, (tx) =>
      this.idempotency.run(
        tx,
        { tenantId: user.tenantId, actorId: user.userId, action: 'invoice.create' },
        key,
        input,
        async () => {
          const inserted = await tx.query<InvoiceRow>(
            `INSERT INTO invoices (tenant_id, currency, total_cents, created_by) VALUES ($1, $2, $3, $4) RETURNING ${RETURNING}`,
            [user.tenantId, input.currency, total.cents, user.userId],
          );
          const invoice = inserted.rows[0] as InvoiceRow;
          await tx.query(
            `INSERT INTO invoice_lines (tenant_id, invoice_id, position, description, quantity, unit_cents)
           SELECT $1, $2, * FROM unnest($3::int[], $4::text[], $5::int[], $6::bigint[])`,
            [
              user.tenantId,
              invoice.id,
              priced.map((l) => l.position),
              priced.map((l) => l.description),
              priced.map((l) => l.quantity),
              priced.map((l) => l.unitCents),
            ],
          );
          await this.audit.record(tx, {
            tenantId: user.tenantId,
            actorId: user.userId,
            action: 'invoice.created',
            entityType: 'invoice',
            entityId: invoice.id,
            metadata: { totalCents: total.cents, currency: input.currency, lines: priced.length },
          });
          return { status: 201, body: toView(invoice) };
        },
      ),
    );
    if (!result.replayed) this.realtime.emitToTenant(user.tenantId, 'invoice.updated', result.body);
    return result;
  }

  async list(user: AuthUser, query: { limit: number; cursor?: string }): Promise<Page<InvoiceView>> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.withTenant(user.tenantId, async (tx) => {
      const result = await tx.query<InvoiceRow>(
        `SELECT ${COLUMNS} FROM invoices
          WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
          ORDER BY created_at DESC, id DESC LIMIT $4`,
        [user.tenantId, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      return result.rows;
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toView), nextCursor: page.nextCursor };
  }

  async get(user: AuthUser, id: string): Promise<InvoiceView> {
    return this.db.withTenant(user.tenantId, async (tx) => {
      const found = await tx.query<InvoiceRow>(
        `SELECT ${COLUMNS} FROM invoices WHERE id = $1 AND tenant_id = $2`,
        [id, user.tenantId],
      );
      const row = found.rows[0];
      if (!row) throw notFound('Invoice');
      const lines = await tx.query<{
        position: number;
        description: string;
        quantity: number;
        unit_cents: string;
      }>(
        'SELECT position, description, quantity, unit_cents FROM invoice_lines WHERE invoice_id = $1 AND tenant_id = $2 ORDER BY position',
        [id, user.tenantId],
      );
      const payments = await tx.query<{
        id: string;
        kind: 'payment' | 'refund';
        amount_cents: string;
        provider: string | null;
        created_at: Date;
      }>(
        'SELECT id, kind, amount_cents, provider, created_at FROM payments WHERE invoice_id = $1 AND tenant_id = $2 ORDER BY created_at, id',
        [id, user.tenantId],
      );
      return {
        ...toView(row),
        lines: lines.rows.map((l) => ({
          position: l.position,
          description: l.description,
          quantity: l.quantity,
          unitCents: Number(l.unit_cents),
        })),
        payments: payments.rows.map((p) => ({
          id: p.id,
          kind: p.kind,
          amountCents: Number(p.amount_cents),
          provider: p.provider,
          createdAt: p.created_at.toISOString(),
        })),
      };
    });
  }

  async issue(user: AuthUser, id: string): Promise<InvoiceView> {
    const view = await this.db.withTenant(user.tenantId, async (tx) => {
      const updated = await tx.query<InvoiceRow>(
        `UPDATE invoices SET status = 'open', version = version + 1, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND status = 'draft' AND total_cents > 0 RETURNING ${RETURNING}`,
        [id, user.tenantId],
      );
      const row = updated.rows[0];
      if (!row)
        throw await this.explainNotUpdated(
          tx,
          user.tenantId,
          id,
          'Only non-empty draft invoices can be issued',
        );
      await this.outbox.enqueue(tx, user.tenantId, 'invoice.issued', { id });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'invoice.issued',
        entityType: 'invoice',
        entityId: id,
      });
      return toView(row);
    });
    this.realtime.emitToTenant(user.tenantId, 'invoice.updated', view);
    return view;
  }

  async void(user: AuthUser, id: string): Promise<InvoiceView> {
    const view = await this.db.withTenant(user.tenantId, async (tx) => {
      const updated = await tx.query<InvoiceRow>(
        `UPDATE invoices SET status = 'void', version = version + 1, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND status IN ('draft', 'open') AND paid_cents = 0 RETURNING ${RETURNING}`,
        [id, user.tenantId],
      );
      const row = updated.rows[0];
      if (!row)
        throw await this.explainNotUpdated(
          tx,
          user.tenantId,
          id,
          'Only unpaid draft/open invoices can be voided',
        );
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'invoice.voided',
        entityType: 'invoice',
        entityId: id,
      });
      return toView(row);
    });
    this.realtime.emitToTenant(user.tenantId, 'invoice.updated', view);
    return view;
  }

  async pay(
    user: AuthUser,
    invoiceId: string,
    amount: string,
    key: string,
  ): Promise<IdempotentResult<{ invoice: InvoiceView; paymentId: string }>> {
    const result = await this.db.withTenant(user.tenantId, (tx) =>
      this.idempotency.run(
        tx,
        { tenantId: user.tenantId, actorId: user.userId, action: 'invoice.pay' },
        key,
        { invoiceId, amount },
        async () => {
          const invoice = await this.currencyOf(tx, user.tenantId, invoiceId);
          const cents = Money.parse(amount, invoice).cents;
          const moved = await this.applyPayment(tx, {
            tenantId: user.tenantId,
            invoiceId,
            cents,
            actorId: user.userId,
            provider: null,
            providerRef: null,
          });
          if (!moved.ok) throw rejectionToError(moved.reason);
          await this.outbox.enqueue(tx, user.tenantId, 'payment.received', { invoiceId, amountCents: cents });
          await this.audit.record(tx, {
            tenantId: user.tenantId,
            actorId: user.userId,
            action: 'payment.recorded',
            entityType: 'invoice',
            entityId: invoiceId,
            metadata: { amountCents: cents },
          });
          return { status: 201, body: { invoice: moved.invoice, paymentId: moved.paymentId } };
        },
      ),
    );
    if (!result.replayed) this.realtime.emitToTenant(user.tenantId, 'invoice.updated', result.body.invoice);
    return result;
  }

  async refund(
    user: AuthUser,
    invoiceId: string,
    input: { amount: string; reason?: string },
    key: string,
  ): Promise<IdempotentResult<{ invoice: InvoiceView; paymentId: string }>> {
    const result = await this.db.withTenant(user.tenantId, (tx) =>
      this.idempotency.run(
        tx,
        { tenantId: user.tenantId, actorId: user.userId, action: 'invoice.refund' },
        key,
        { invoiceId, ...input },
        async () => {
          const currency = await this.currencyOf(tx, user.tenantId, invoiceId);
          const cents = Money.parse(input.amount, currency).cents;
          if (refundNeedsApproval(user.role, cents, this.env.REFUND_APPROVAL_THRESHOLD_CENTS)) {
            throw forbidden(
              'REFUND_NEEDS_APPROVAL',
              'Refunds above the threshold must be made by an admin or owner',
            );
          }
          const moved = await this.applyRefund(tx, {
            tenantId: user.tenantId,
            invoiceId,
            cents,
            actorId: user.userId,
          });
          if (!moved.ok) throw rejectionToError(moved.reason);
          await this.outbox.enqueue(tx, user.tenantId, 'refund.created', { invoiceId, amountCents: cents });
          await this.audit.record(tx, {
            tenantId: user.tenantId,
            actorId: user.userId,
            action: 'refund.created',
            entityType: 'invoice',
            entityId: invoiceId,
            metadata: { amountCents: cents, reason: input.reason },
          });
          return { status: 201, body: { invoice: moved.invoice, paymentId: moved.paymentId } };
        },
      ),
    );
    if (!result.replayed) this.realtime.emitToTenant(user.tenantId, 'invoice.updated', result.body.invoice);
    return result;
  }

  /**
   * Records money received. Shared by the manual endpoint and the inbound provider webhook.
   *
   * The balance check lives IN the UPDATE's WHERE clause, not in a read-then-write in application code:
   * Postgres re-evaluates the predicate after waiting for a competing row lock, so N concurrent payments
   * can never overshoot the total — no explicit lock, no retry loop. The SAVEPOINT lets a business
   * rejection roll back this statement pair without aborting the caller's transaction.
   */
  async applyPayment(
    tx: Tx,
    p: {
      tenantId: string;
      invoiceId: string;
      cents: number;
      actorId: string | null;
      provider: string | null;
      providerRef: string | null;
    },
  ): Promise<MoneyMovement> {
    await tx.query('SAVEPOINT apply_payment');
    try {
      const updated = await tx.query<InvoiceRow>(
        `UPDATE invoices
            SET paid_cents = paid_cents + $3,
                status = CASE WHEN paid_cents + $3 = total_cents THEN 'paid' ELSE status END,
                version = version + 1, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND status = 'open' AND paid_cents + $3 <= total_cents
          RETURNING ${RETURNING}`,
        [p.invoiceId, p.tenantId, p.cents],
      );
      const row = updated.rows[0];
      if (!row) throw new Rejected(await this.diagnose(tx, p.tenantId, p.invoiceId));
      const ledger = await tx.query<{ id: string }>(
        `INSERT INTO payments (tenant_id, invoice_id, kind, amount_cents, provider, provider_ref, created_by)
         VALUES ($1, $2, 'payment', $3, $4, $5, $6)
         ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
         RETURNING id`,
        [p.tenantId, p.invoiceId, p.cents, p.provider, p.providerRef, p.actorId],
      );
      const paymentId = ledger.rows[0]?.id;
      if (!paymentId) throw new Rejected('duplicate_provider_ref');
      await tx.query('RELEASE SAVEPOINT apply_payment');
      return { ok: true, invoice: toView(row), paymentId };
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT apply_payment');
      if (error instanceof Rejected) return { ok: false, reason: error.reason };
      throw error;
    }
  }

  async applyRefund(
    tx: Tx,
    p: { tenantId: string; invoiceId: string; cents: number; actorId: string | null },
  ): Promise<MoneyMovement> {
    await tx.query('SAVEPOINT apply_refund');
    try {
      const updated = await tx.query<InvoiceRow>(
        `UPDATE invoices SET refunded_cents = refunded_cents + $3, version = version + 1, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND refunded_cents + $3 <= paid_cents RETURNING ${RETURNING}`,
        [p.invoiceId, p.tenantId, p.cents],
      );
      const row = updated.rows[0];
      if (!row) {
        const reason = await this.diagnose(tx, p.tenantId, p.invoiceId);
        throw new Rejected(reason === 'not_found' ? 'not_found' : 'exceeds_paid');
      }
      const ledger = await tx.query<{ id: string }>(
        `INSERT INTO payments (tenant_id, invoice_id, kind, amount_cents, created_by) VALUES ($1, $2, 'refund', $3, $4) RETURNING id`,
        [p.tenantId, p.invoiceId, p.cents, p.actorId],
      );
      await tx.query('RELEASE SAVEPOINT apply_refund');
      return { ok: true, invoice: toView(row), paymentId: (ledger.rows[0] as { id: string }).id };
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT apply_refund');
      if (error instanceof Rejected) return { ok: false, reason: error.reason };
      throw error;
    }
  }

  private async currencyOf(tx: Tx, tenantId: string, invoiceId: string): Promise<string> {
    const r = await tx.query<{ currency: string }>(
      'SELECT currency FROM invoices WHERE id = $1 AND tenant_id = $2',
      [invoiceId, tenantId],
    );
    const currency = r.rows[0]?.currency;
    if (!currency) throw notFound('Invoice');
    return currency;
  }

  /** After a guarded UPDATE touched nothing: say WHY, so the client gets 404 vs 409 vs 422 instead of a shrug. */
  private async diagnose(tx: Tx, tenantId: string, invoiceId: string): Promise<Rejection> {
    const r = await tx.query<{ status: string }>(
      'SELECT status FROM invoices WHERE id = $1 AND tenant_id = $2',
      [invoiceId, tenantId],
    );
    const status = r.rows[0]?.status;
    if (!status) return 'not_found';
    return status === 'open' ? 'exceeds_balance' : 'not_open';
  }

  private async explainNotUpdated(tx: Tx, tenantId: string, invoiceId: string, message: string) {
    const r = await tx.query('SELECT 1 FROM invoices WHERE id = $1 AND tenant_id = $2', [
      invoiceId,
      tenantId,
    ]);
    return r.rowCount === 0 ? notFound('Invoice') : conflict('INVALID_STATE', message);
  }
}
