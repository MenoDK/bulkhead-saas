import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { type AuthedRequest, Public } from '../../common/auth';
import { SignatureError, verifySignature } from '../../common/crypto/signature';
import { badRequest, unauthorized } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { BillingService, type InvoiceView } from '../billing/billing.service';
import { MetricsService } from '../observability/metrics.service';
import { OutboxService } from '../outbox/outbox.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PaymentProviderClient, ProviderUnavailableError } from './payment-provider.client';

const PROVIDER = 'acme-pay';

const envelope = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  data: z.object({
    providerRef: z.string().min(1).max(100),
    // Only trusted in "signed payload" mode; with reverse confirmation these come from the provider API instead.
    tenantId: z.uuid().optional(),
    invoiceId: z.uuid().optional(),
    amountCents: z.number().int().positive().optional(),
  }),
});

type Outcome = { status: 'processed' } | { status: 'duplicate' } | { status: 'ignored'; reason: string };
type TxOutcome = Outcome | { status: 'processed'; invoice: InvoiceView };

/**
 * Inbound payment notifications. Properties, each covered by an e2e test:
 *  1. authenticity + freshness: HMAC over the RAW body with a timestamp window (see common/crypto/signature);
 *  2. exactly-once EFFECT: the inbox row (provider, event_id) and the money movement commit in ONE transaction;
 *  3. replays and provider retries are harmless: duplicate event ids and duplicate provider refs are no-ops;
 *  4. optional reverse confirmation, so the body is a pointer and never the source of truth;
 *  5. non-final states do not consume the event id, so a later "paid" notification is still processed.
 */
@Controller('webhooks')
export class PaymentsWebhookController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly billing: BillingService,
    private readonly provider: PaymentProviderClient,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeGateway,
    private readonly metrics: MetricsService,
  ) {}

  @Public()
  @Post('payments')
  @HttpCode(200)
  async receive(
    @Req() req: AuthedRequest,
    @Headers('x-signature') signature: string | undefined,
  ): Promise<Outcome> {
    if (!req.rawBody) throw badRequest('RAW_BODY_MISSING', 'Request body is required');
    try {
      verifySignature(
        signature,
        req.rawBody,
        this.env.PAYMENT_WEBHOOK_SECRETS.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        {
          toleranceSeconds: this.env.WEBHOOK_TOLERANCE_SECONDS,
        },
      );
    } catch (error) {
      this.metrics.inboundWebhooks.inc({ result: 'rejected' });
      // One generic answer: the specific reason (expired vs mismatch) helps an attacker more than a debugger.
      if (error instanceof SignatureError)
        throw unauthorized('INVALID_SIGNATURE', 'Invalid webhook signature');
      throw error;
    }

    const parsed = envelope.safeParse(JSON.parse(req.rawBody.toString('utf8')) as unknown);
    if (!parsed.success) throw badRequest('INVALID_PAYLOAD', 'Unexpected webhook payload');
    const event = parsed.data;
    if (event.type !== 'payment.succeeded') return this.done({ status: 'ignored', reason: 'unhandled_type' });

    // Resolve WHAT happened: from the provider API (pointer mode) or from the signed body.
    let target: { tenantId: string; invoiceId: string; cents: number };
    if (this.provider.enabled) {
      let confirmed;
      try {
        confirmed = await this.provider.confirm(event.data.providerRef);
      } catch (error) {
        if (error instanceof ProviderUnavailableError)
          throw new ServiceUnavailableException('Could not confirm the payment; retry later');
        throw error;
      }
      if (!confirmed) return this.done({ status: 'ignored', reason: 'unknown_payment' });
      if (confirmed.status !== 'succeeded') return this.done({ status: 'ignored', reason: 'not_final' });
      target = {
        tenantId: confirmed.metadata.tenantId,
        invoiceId: confirmed.metadata.invoiceId,
        cents: confirmed.amountCents,
      };
    } else {
      const { tenantId, invoiceId, amountCents } = event.data;
      if (!tenantId || !invoiceId || !amountCents)
        throw badRequest('INVALID_PAYLOAD', 'tenantId, invoiceId and amountCents are required');
      target = { tenantId, invoiceId, cents: amountCents };
    }

    const result = await this.db.withTenant(target.tenantId, async (tx): Promise<TxOutcome> => {
      const inbox = await tx.query(
        'INSERT INTO webhook_events (provider, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [PROVIDER, event.id],
      );
      if (inbox.rowCount === 0) return { status: 'duplicate' };

      const moved = await this.billing.applyPayment(tx, {
        tenantId: target.tenantId,
        invoiceId: target.invoiceId,
        cents: target.cents,
        actorId: null,
        provider: PROVIDER,
        providerRef: event.data.providerRef,
      });
      // A business rejection (unknown invoice, already settled...) is final: keep the inbox row so the provider's
      // retries stop mattering, and answer 200 so it stops retrying.
      if (!moved.ok) return { status: 'ignored', reason: moved.reason };

      await this.outbox.enqueue(tx, target.tenantId, 'payment.received', {
        invoiceId: target.invoiceId,
        amountCents: target.cents,
        via: PROVIDER,
      });
      await this.audit.record(tx, {
        tenantId: target.tenantId,
        actorId: null,
        action: 'payment.received_webhook',
        entityType: 'invoice',
        entityId: target.invoiceId,
        metadata: { amountCents: target.cents, provider: PROVIDER, eventId: event.id },
      });
      return { status: 'processed', invoice: moved.invoice };
    });
    if ('invoice' in result) {
      // After commit, and from a local variable: controllers are singletons, so no per-request state may live on `this`.
      this.realtime.emitToTenant(target.tenantId, 'invoice.updated', result.invoice);
      return this.done({ status: 'processed' });
    }
    return this.done(result);
  }

  private done(outcome: Outcome): Outcome {
    this.metrics.inboundWebhooks.inc({ result: outcome.status });
    return outcome;
  }
}
