import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth';
import { SecretBox } from '../../common/crypto/cipher';
import { badRequest, notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { assertPublicTarget, UnresolvableTargetError, UnsafeTargetError } from '../outbox/ssrf';

export interface EndpointView {
  id: string;
  url: string;
  active: boolean;
  createdAt: string;
}

@Injectable()
export class WebhookEndpointsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly box: SecretBox,
  ) {}

  /** The signing secret is returned exactly once, here; afterwards only its encrypted form exists. */
  async create(user: AuthUser, url: string): Promise<EndpointView & { secret: string }> {
    try {
      await assertPublicTarget(url, this.env.ALLOW_PRIVATE_WEBHOOK_TARGETS);
    } catch (error) {
      if (error instanceof UnsafeTargetError) throw badRequest('UNSAFE_TARGET', error.message);
      if (error instanceof UnresolvableTargetError) throw badRequest('UNRESOLVABLE_TARGET', error.message);
      throw error;
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return this.db.withTenant(user.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string; created_at: Date }>(
        'INSERT INTO webhook_endpoints (tenant_id, url, secret) VALUES ($1, $2, $3) RETURNING id, created_at',
        [user.tenantId, url, this.box.seal(secret)],
      );
      const row = rows[0] as { id: string; created_at: Date };
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'webhook_endpoint.created',
        entityType: 'webhook_endpoint',
        entityId: row.id,
        metadata: { url },
      });
      return { id: row.id, url, active: true, createdAt: row.created_at.toISOString(), secret };
    });
  }

  async list(user: AuthUser): Promise<EndpointView[]> {
    return this.db.withTenant(user.tenantId, async (tx) => {
      const { rows } = await tx.query<{ id: string; url: string; active: boolean; created_at: Date }>(
        'SELECT id, url, active, created_at FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC',
        [user.tenantId],
      );
      return rows.map((r) => ({
        id: r.id,
        url: r.url,
        active: r.active,
        createdAt: r.created_at.toISOString(),
      }));
    });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.db.withTenant(user.tenantId, async (tx) => {
      const r = await tx.query('DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [
        id,
        user.tenantId,
      ]);
      if (r.rowCount === 0) throw notFound('Webhook endpoint');
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'webhook_endpoint.deleted',
        entityType: 'webhook_endpoint',
        entityId: id,
      });
    });
  }

  /** Queues a `ping` through the normal pipeline, so a successful ping proves the whole path works. */
  async ping(user: AuthUser, id: string): Promise<{ queued: boolean }> {
    return this.db.withTenant(user.tenantId, async (tx) => {
      const exists = await tx.query('SELECT 1 FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [
        id,
        user.tenantId,
      ]);
      if (exists.rowCount === 0) throw notFound('Webhook endpoint');
      await tx.query(
        `INSERT INTO outbox_events (tenant_id, endpoint_id, topic, payload) VALUES ($1, $2, 'ping', '{"ok":true}'::jsonb)`,
        [user.tenantId, id],
      );
      return { queued: true };
    });
  }

  async deliveries(user: AuthUser, id: string) {
    return this.db.withTenant(user.tenantId, async (tx) => {
      const exists = await tx.query('SELECT 1 FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [
        id,
        user.tenantId,
      ]);
      if (exists.rowCount === 0) throw notFound('Webhook endpoint');
      // outbox_events is a system table without RLS, so the tenant filter here is load-bearing (and covered by an e2e test).
      const { rows } = await tx.query<{
        id: string;
        topic: string;
        status: string;
        attempts: number;
        last_error: string | null;
        created_at: Date;
        delivered_at: Date | null;
      }>(
        `SELECT id, topic, status, attempts, last_error, created_at, delivered_at FROM outbox_events
          WHERE tenant_id = $1 AND endpoint_id = $2 ORDER BY created_at DESC LIMIT 50`,
        [user.tenantId, id],
      );
      return rows.map((r) => ({
        id: r.id,
        topic: r.topic,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
        createdAt: r.created_at.toISOString(),
        deliveredAt: r.delivered_at?.toISOString() ?? null,
      }));
    });
  }
}
