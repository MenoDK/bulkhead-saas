import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { ENV, type Env } from '../config/env';

/** The only surface repositories/services see: no way to commit, roll back or release by mistake. */
export interface Tx {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // A runaway query or a forgotten transaction must not be able to hold the pool hostage.
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 20_000,
    });
  }

  /** For system tables that carry no tenant (users, sessions, outbox...). */
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(sql, params as unknown[]);
  }

  /** A transaction with NO tenant context: tenant-scoped (RLS) tables return nothing inside it. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn);
  }

  /**
   * A transaction bound to one tenant. `set_config(..., true)` is transaction-local, so the tenant
   * can never leak to the next request that borrows the same pooled connection. Row-level security
   * policies read it through `current_tenant()`.
   */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(tenantId)) throw new Error('withTenant: tenantId is not a UUID');
    return this.run(fn, tenantId);
  }

  private async run<T>(fn: (tx: Tx) => Promise<T>, tenantId?: string): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn({
        query: (sql, params) => client.query(sql, params as unknown[] | undefined),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the original error is the one worth reporting */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
