import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { tooManyRequests } from './errors';

/**
 * Fixed-window counters kept in Postgres, so the limit holds across replicas (an in-process Map
 * would multiply the allowance by the number of instances). One atomic upsert per attempt; keys are
 * hashed so that no e-mail address or IP is stored in clear text.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly db: DatabaseService) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const hashed = createHash('sha256').update(key).digest('hex');
    const { rows } = await this.db.query<{ count: number; ttl: number }>(
      `INSERT INTO rate_limits (key, count, expires_at)
       VALUES ($1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (key) DO UPDATE SET
         count      = CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.count + 1 END,
         expires_at = CASE WHEN rate_limits.expires_at < now() THEN now() + make_interval(secs => $2) ELSE rate_limits.expires_at END
       RETURNING count, ceil(extract(epoch FROM (expires_at - now())))::int AS ttl`,
      [hashed, windowSeconds],
    );
    const row = rows[0];
    if (row && row.count > limit) throw tooManyRequests(Math.max(1, row.ttl));
  }

  async purgeExpired(): Promise<number> {
    const result = await this.db.query('DELETE FROM rate_limits WHERE expires_at < now()');
    return result.rowCount ?? 0;
  }
}
