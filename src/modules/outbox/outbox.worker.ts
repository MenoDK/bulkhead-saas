import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { SecretBox } from '../../common/crypto/cipher';
import { buildSignatureHeader } from '../../common/crypto/signature';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { MetricsService } from '../observability/metrics.service';
import { nextDelayMs } from './backoff';
import { postJson } from './http-post';

interface ClaimedEvent {
  id: string;
  tenant_id: string;
  endpoint_id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: Date;
}

export interface TickResult {
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
}

/**
 * Delivers outbox events (at-least-once; receivers de-duplicate on X-Event-Id).
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED` plus a LEASE (`next_attempt_at` pushed into the future in
 * the claiming statement). Consequences worth knowing:
 *  - any number of workers can run concurrently; they never pick the same row;
 *  - no database lock or transaction is held while the HTTP call is in flight (slow receivers
 *    cannot exhaust the pool);
 *  - a worker that crashes mid-delivery simply lets its lease expire and the row becomes due again.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private maintenanceTimer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly metrics: MetricsService,
    private readonly box: SecretBox,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.OUTBOX_WORKER) return;
    this.schedule();
    this.maintenanceTimer = setInterval(
      () => void this.maintenance().catch((e: unknown) => this.logger.error(String(e))),
      10 * 60_000,
    );
    this.maintenanceTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.maintenanceTimer);
    while (this.running) await new Promise((r) => setTimeout(r, 25)); // let the in-flight batch finish
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick()
        .catch((e: unknown) => this.logger.error(`tick failed: ${String(e)}`))
        .finally(() => this.schedule());
    }, this.env.OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async tick(): Promise<TickResult> {
    this.running = true;
    try {
      const claimed = await this.claim();
      const outcomes = await Promise.all(claimed.map((event) => this.deliver(event)));
      return {
        claimed: claimed.length,
        delivered: outcomes.filter((o) => o === 'delivered').length,
        retried: outcomes.filter((o) => o === 'retry').length,
        dead: outcomes.filter((o) => o === 'dead').length,
      };
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<ClaimedEvent[]> {
    const { rows } = await this.db.query<ClaimedEvent>(
      `UPDATE outbox_events o
          SET attempts = o.attempts + 1,
              next_attempt_at = now() + make_interval(secs => $2)
        WHERE o.id IN (
          SELECT id FROM outbox_events
           WHERE status = 'pending' AND next_attempt_at <= now()
           ORDER BY next_attempt_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1)
        RETURNING o.id, o.tenant_id, o.endpoint_id, o.topic, o.payload, o.attempts, o.created_at`,
      [this.env.OUTBOX_BATCH_SIZE, this.env.OUTBOX_LEASE_SECONDS],
    );
    return rows;
  }

  private async deliver(event: ClaimedEvent): Promise<'delivered' | 'retry' | 'dead'> {
    try {
      const endpoint = await this.db.withTenant(event.tenant_id, async (tx) => {
        const r = await tx.query<{ url: string; secret: string; active: boolean }>(
          'SELECT url, secret, active FROM webhook_endpoints WHERE id = $1',
          [event.endpoint_id],
        );
        return r.rows[0];
      });
      if (!endpoint?.active) return await this.finish(event, 'dead', 'endpoint missing or inactive');

      const body = JSON.stringify({
        id: event.id,
        topic: event.topic,
        createdAt: event.created_at.toISOString(),
        data: event.payload,
      });
      const { status } = await postJson(
        endpoint.url,
        body,
        {
          'x-event-id': event.id,
          'x-event-topic': event.topic,
          'x-signature': buildSignatureHeader(this.box.open(endpoint.secret), body),
          'user-agent': 'bulkhead-webhooks/1',
        },
        {
          timeoutMs: this.env.OUTBOX_DELIVERY_TIMEOUT_MS,
          allowPrivate: this.env.ALLOW_PRIVATE_WEBHOOK_TARGETS,
        },
      );
      if (status >= 200 && status < 300) return await this.finish(event, 'delivered');
      return await this.finish(event, 'retry', `HTTP ${status}`);
    } catch (error) {
      return await this.finish(event, 'retry', error instanceof Error ? error.message : String(error));
    }
  }

  private async finish(
    event: ClaimedEvent,
    outcome: 'delivered' | 'retry' | 'dead',
    error?: string,
  ): Promise<'delivered' | 'retry' | 'dead'> {
    if (outcome === 'delivered') {
      await this.db.query(
        "UPDATE outbox_events SET status = 'delivered', delivered_at = now(), last_error = NULL WHERE id = $1",
        [event.id],
      );
      this.metrics.outboxDeliveries.inc({ result: 'delivered' });
      return 'delivered';
    }
    const exhausted = outcome === 'dead' || event.attempts >= this.env.OUTBOX_MAX_ATTEMPTS;
    await this.db.query(
      `UPDATE outbox_events
          SET status = $2, last_error = $3, next_attempt_at = now() + make_interval(secs => $4)
        WHERE id = $1`,
      [
        event.id,
        exhausted ? 'dead' : 'pending',
        (error ?? '').slice(0, 500),
        nextDelayMs(event.attempts) / 1000,
      ],
    );
    this.metrics.outboxDeliveries.inc({ result: exhausted ? 'dead' : 'retry' });
    return exhausted ? 'dead' : 'retry';
  }

  /** Housekeeping for tables that would otherwise grow forever. */
  async maintenance(): Promise<void> {
    await this.db.query('DELETE FROM rate_limits WHERE expires_at < now()');
    await this.db.query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'");
    await this.db.query("DELETE FROM webhook_events WHERE received_at < now() - interval '30 days'");
    await this.db.query(
      "DELETE FROM outbox_events WHERE status = 'delivered' AND delivered_at < now() - interval '14 days'",
    );
    // idempotency_keys is RLS-protected, so it is cleaned tenant by tenant (cheap: one indexed DELETE each).
    const { rows } = await this.db.query<{ id: string }>('SELECT id FROM tenants ORDER BY id');
    for (const { id } of rows) {
      await this.db.withTenant(id, (tx) => tx.query('DELETE FROM idempotency_keys WHERE expires_at < now()'));
    }
  }
}
