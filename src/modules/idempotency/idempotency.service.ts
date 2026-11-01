import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { badRequest, unprocessable } from '../../common/errors';
import { canonicalize } from '../audit/audit-chain';
import type { Tx } from '../../database/database.service';

export interface IdempotencyScope {
  tenantId: string;
  actorId: string;
  action: string;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;
const TTL_HOURS = 24;

export function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || !KEY_PATTERN.test(key)) {
    throw badRequest(
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header (8-200 chars: letters, digits, _ . : -) is required',
    );
  }
  return key;
}

/**
 * "Do this exactly once": a retried request gets the stored response instead of a second effect.
 *
 * It runs in the SAME transaction as the business change, so "effect applied" and "key recorded"
 * are atomic: there is no window in which the money moved but the key was lost (which would let a
 * retry charge twice), nor one in which the key exists without the effect.
 * An advisory lock on the key serialises concurrent duplicates: the second request waits, then sees
 * the first one's committed result.
 */
@Injectable()
export class IdempotencyService {
  async run<T extends object>(
    tx: Tx,
    scope: IdempotencyScope,
    key: string,
    fingerprint: unknown,
    effect: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = createHash('sha256').update(canonicalize(fingerprint)).digest('hex');
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `idem:${scope.tenantId}:${scope.actorId}:${scope.action}:${key}`,
    ]);

    const existing = await tx.query<{ request_hash: string; response_status: number; response_body: T }>(
      `SELECT request_hash, response_status, response_body FROM idempotency_keys
        WHERE tenant_id = $1 AND actor_id = $2 AND action = $3 AND key = $4 AND expires_at > now()`,
      [scope.tenantId, scope.actorId, scope.action, key],
    );
    const hit = existing.rows[0];
    if (hit) {
      if (hit.request_hash !== requestHash) {
        throw unprocessable(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different request',
        );
      }
      return { status: hit.response_status, body: hit.response_body, replayed: true };
    }

    const result = await effect();
    await tx.query(
      `INSERT INTO idempotency_keys (tenant_id, actor_id, action, key, request_hash, response_status, response_body, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now() + make_interval(hours => $8))
       ON CONFLICT (tenant_id, actor_id, action, key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash, response_status = EXCLUDED.response_status,
             response_body = EXCLUDED.response_body, created_at = now(), expires_at = EXCLUDED.expires_at`,
      [
        scope.tenantId,
        scope.actorId,
        scope.action,
        key,
        requestHash,
        result.status,
        JSON.stringify(result.body),
        TTL_HOURS,
      ],
    );
    return { ...result, replayed: false };
  }
}
