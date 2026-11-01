import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DatabaseService, type Tx } from '../../database/database.service';
import {
  type AuditEntryData,
  computeHash,
  redactMetadata,
  type StoredAuditEntry,
  verifyChain,
  type ChainVerdict,
} from './audit-chain';
import { type ExportEnvelope, signExport } from './audit-export';

export interface AuditInput {
  tenantId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: unknown;
}

interface AuditRow {
  seq: string;
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  prev_hash: string | null;
  hash: string;
  created_at: Date;
}

const COLUMNS =
  'seq, id, tenant_id, actor_id, action, entity_type, entity_id, metadata, prev_hash, hash, created_at';
const VERIFY_BATCH = 1000;
export const MAX_EXPORT_ENTRIES = 5000;

const toEntry = (r: AuditRow): StoredAuditEntry => ({
  seq: Number(r.seq),
  id: r.id,
  tenantId: r.tenant_id,
  actorId: r.actor_id,
  action: r.action,
  entityType: r.entity_type,
  entityId: r.entity_id,
  metadata: r.metadata,
  createdAt: r.created_at.toISOString(),
  prevHash: r.prev_hash,
  hash: r.hash,
});

@Injectable()
export class AuditService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Appends to the tenant's hash chain INSIDE the caller's transaction, so the business change and
   * its audit record commit or roll back together.
   *
   * A per-tenant advisory lock serialises appends (two writers must not both extend the same head).
   * Call this LAST in a transaction: the lock is held until commit, and taking it after every row
   * lock the transaction needs keeps lock ordering consistent (no deadlocks between writers).
   */
  async record(tx: Tx, input: AuditInput): Promise<void> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`audit:${input.tenantId}`]);
    const head = await tx.query<{ hash: string }>(
      'SELECT hash FROM audit_logs WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1',
      [input.tenantId],
    );
    const prevHash = head.rows[0]?.hash ?? null;

    const entry: AuditEntryData = {
      id: randomUUID(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: redactMetadata(input.metadata ?? {}),
      createdAt: new Date().toISOString(),
    };
    await tx.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_id, action, entity_type, entity_id, metadata, prev_hash, hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        entry.id,
        entry.tenantId,
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.metadata),
        prevHash,
        computeHash(entry, prevHash),
        entry.createdAt,
      ],
    );
  }

  /** Newest first, keyset-paginated on the identity column. */
  async list(
    tenantId: string,
    limit: number,
    beforeSeq?: number,
  ): Promise<{ items: StoredAuditEntry[]; nextBefore: number | null }> {
    const rows = await this.db.withTenant(tenantId, async (tx) => {
      const result = await tx.query<AuditRow>(
        `SELECT ${COLUMNS} FROM audit_logs WHERE tenant_id = $1 AND ($2::bigint IS NULL OR seq < $2) ORDER BY seq DESC LIMIT $3`,
        [tenantId, beforeSeq ?? null, limit + 1],
      );
      return result.rows;
    });
    const items = rows.slice(0, limit).map(toEntry);
    const last = items[items.length - 1];
    return { items, nextBefore: rows.length > limit && last ? last.seq : null };
  }

  /** Re-computes the whole chain in bounded batches, so memory stays flat however long the log is. */
  async verify(tenantId: string): Promise<ChainVerdict & { headHash: string | null }> {
    return this.db.withTenant(tenantId, async (tx) => {
      let afterSeq = 0;
      let prev: string | null = null;
      let total = 0;
      for (;;) {
        const { rows } = await tx.query<AuditRow>(
          `SELECT ${COLUMNS} FROM audit_logs WHERE tenant_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
          [tenantId, afterSeq, VERIFY_BATCH],
        );
        if (rows.length === 0) return { valid: true, checked: total, headHash: prev };
        const verdict = verifyChain(rows.map(toEntry), prev);
        if (!verdict.valid) return { ...verdict, checked: total + verdict.checked, headHash: prev };
        total += verdict.checked;
        const last = rows[rows.length - 1];
        if (!last) return { valid: true, checked: total, headHash: prev };
        afterSeq = Number(last.seq);
        prev = last.hash;
      }
    });
  }

  /** A signed, self-verifying slice of the chain, for handing to an auditor. */
  async export(
    tenantId: string,
    fromSeq: number,
    limit: number,
  ): Promise<{ envelope: ExportEnvelope; signature: string; entries: StoredAuditEntry[] }> {
    const rows = await this.db.withTenant(tenantId, async (tx) => {
      const result = await tx.query<AuditRow>(
        `SELECT ${COLUMNS} FROM audit_logs WHERE tenant_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
        [tenantId, fromSeq, Math.min(limit, MAX_EXPORT_ENTRIES)],
      );
      return result.rows;
    });
    const entries = rows.map(toEntry);
    const envelope: ExportEnvelope = {
      tenantId,
      generatedAt: new Date().toISOString(),
      count: entries.length,
      fromPrevHash: entries[0]?.prevHash ?? null,
      headHash: entries[entries.length - 1]?.hash ?? null,
    };
    return { envelope, signature: signExport(this.env.AUDIT_EXPORT_SECRET, envelope), entries };
  }
}
