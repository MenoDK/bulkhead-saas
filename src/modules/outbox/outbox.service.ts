import { Injectable } from '@nestjs/common';
import type { Tx } from '../../database/database.service';

/**
 * Transactional outbox: the event row is written in the SAME transaction as the change that caused
 * it. Either both exist or neither does — there is no "committed but never announced" and no
 * "announced but rolled back". A separate worker (outbox.worker.ts) delivers rows afterwards.
 */
@Injectable()
export class OutboxService {
  /** Fans out to every active endpoint of the (RLS-scoped) tenant. Returns how many events were queued. */
  async enqueue(tx: Tx, tenantId: string, topic: string, payload: Record<string, unknown>): Promise<number> {
    const result = await tx.query(
      `INSERT INTO outbox_events (tenant_id, endpoint_id, topic, payload)
       SELECT $1, id, $2, $3::jsonb FROM webhook_endpoints WHERE active`,
      [tenantId, topic, JSON.stringify(payload)],
    );
    return result.rowCount ?? 0;
  }
}
