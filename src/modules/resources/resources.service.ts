import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth';
import { conflict, forbidden, notFound } from '../../common/errors';
import { decodeCursor, type Page, toPage } from '../../common/pagination';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { canModifyResource } from './policy';

export interface ResourceView {
  id: string;
  name: string;
  data: Record<string, unknown>;
  status: 'active' | 'archived';
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ResourceRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  status: 'active' | 'archived';
  version: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, name, data, status, version, created_by, created_at, updated_at';
const toView = (r: ResourceRow): ResourceView => ({
  id: r.id,
  name: r.name,
  data: r.data,
  status: r.status,
  version: r.version,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

@Injectable()
export class ResourcesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(
    user: AuthUser,
    input: { name: string; data: Record<string, unknown> },
  ): Promise<ResourceView> {
    const view = await this.db.withTenant(user.tenantId, async (tx) => {
      const { rows } = await tx.query<ResourceRow>(
        `INSERT INTO resources (tenant_id, name, data, created_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING ${COLUMNS}`,
        [user.tenantId, input.name, JSON.stringify(input.data), user.userId],
      );
      const created = toView(rows[0] as ResourceRow);
      await this.outbox.enqueue(tx, user.tenantId, 'resource.created', {
        id: created.id,
        name: created.name,
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'resource.created',
        entityType: 'resource',
        entityId: created.id,
        metadata: { name: created.name },
      });
      return created;
    });
    this.realtime.emitToTenant(user.tenantId, 'resource.created', view);
    return view;
  }

  async list(
    user: AuthUser,
    query: { limit: number; cursor?: string; status?: 'active' | 'archived' },
  ): Promise<Page<ResourceView>> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db.withTenant(user.tenantId, async (tx) => {
      // Explicit tenant filter AND row-level security: the filter lets the planner use the tenant-leading
      // index; RLS is the safety net that still holds if someone forgets the filter.
      const result = await tx.query<ResourceRow>(
        `SELECT ${COLUMNS} FROM resources
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR status = $2)
            AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid))
          ORDER BY created_at DESC, id DESC
          LIMIT $5`,
        [user.tenantId, query.status ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
      );
      return result.rows;
    });
    const page = toPage(rows, query.limit);
    return { items: page.items.map(toView) as never, nextCursor: page.nextCursor };
  }

  async get(user: AuthUser, id: string): Promise<ResourceView> {
    const row = await this.db.withTenant(user.tenantId, async (tx) => {
      const { rows } = await tx.query<ResourceRow>(
        `SELECT ${COLUMNS} FROM resources WHERE id = $1 AND tenant_id = $2`,
        [id, user.tenantId],
      );
      return rows[0];
    });
    // Another tenant's record is simply invisible: 404, not 403, so ids cannot be probed across tenants.
    if (!row) throw notFound('Resource');
    return toView(row);
  }

  async update(
    user: AuthUser,
    id: string,
    input: { version: number; name?: string; data?: Record<string, unknown>; status?: 'active' | 'archived' },
  ): Promise<ResourceView> {
    const view = await this.db.withTenant(user.tenantId, async (tx) => {
      const current = await tx.query<ResourceRow>(
        `SELECT ${COLUMNS} FROM resources WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, user.tenantId],
      );
      const row = current.rows[0];
      if (!row) throw notFound('Resource');
      if (!canModifyResource(user, { createdBy: row.created_by }))
        throw forbidden('NOT_YOUR_RESOURCE', 'You can only change resources you created');
      if (row.version !== input.version) {
        throw conflict('VERSION_CONFLICT', 'The resource was changed by someone else', {
          currentVersion: row.version,
        });
      }
      const updated = await tx.query<ResourceRow>(
        `UPDATE resources
            SET name = COALESCE($3, name), data = COALESCE($4::jsonb, data), status = COALESCE($5, status),
                version = version + 1, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 RETURNING ${COLUMNS}`,
        [
          id,
          user.tenantId,
          input.name ?? null,
          input.data ? JSON.stringify(input.data) : null,
          input.status ?? null,
        ],
      );
      const next = toView(updated.rows[0] as ResourceRow);
      await this.outbox.enqueue(tx, user.tenantId, 'resource.updated', { id, version: next.version });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'resource.updated',
        entityType: 'resource',
        entityId: id,
        metadata: { fields: Object.keys(input).filter((k) => k !== 'version'), version: next.version },
      });
      return next;
    });
    this.realtime.emitToTenant(user.tenantId, 'resource.updated', view);
    return view;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.db.withTenant(user.tenantId, async (tx) => {
      const deleted = await tx.query<{ name: string }>(
        'DELETE FROM resources WHERE id = $1 AND tenant_id = $2 RETURNING name',
        [id, user.tenantId],
      );
      if (deleted.rowCount === 0) throw notFound('Resource');
      await this.outbox.enqueue(tx, user.tenantId, 'resource.deleted', { id });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'resource.deleted',
        entityType: 'resource',
        entityId: id,
        metadata: { name: deleted.rows[0]?.name },
      });
    });
    this.realtime.emitToTenant(user.tenantId, 'resource.deleted', { id });
  }
}
