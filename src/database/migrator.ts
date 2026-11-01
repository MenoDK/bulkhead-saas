import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

const APP_ROLE = 'app_user';
/** Arbitrary constant: serialises concurrent migrators (several replicas starting together). */
const MIGRATION_LOCK_KEY = 727_274;

export interface MigrateOptions {
  ownerUrl: string;
  appRolePassword: string;
  dir?: string;
  log?: (message: string) => void;
}

/**
 * Applies `db/migrations/*.sql` in order, each in its own transaction, recording a checksum.
 * Editing an already-applied migration is detected and refused: history is immutable.
 */
export async function migrate(options: MigrateOptions): Promise<string[]> {
  const dir = options.dir ?? join(__dirname, '..', '..', 'db', 'migrations');
  const log = options.log ?? (() => undefined);
  const pool = new Pool({ connectionString: options.ownerUrl, max: 1 });
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await ensureAppRole(client, options.appRolePassword);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);

    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const done = new Map<string, string>(
      (
        await client.query<{ version: string; checksum: string }>(
          'SELECT version, checksum FROM schema_migrations',
        )
      ).rows.map((r) => [r.version, r.checksum]),
    );

    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

/**
 * Creates (or refreshes the password of) the unprivileged application role. Postgres itself does
 * the quoting (`format(%I, %L)`), so neither the name nor the password can break out of the statement.
 */
async function ensureAppRole(client: import('pg').PoolClient, password: string): Promise<void> {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  const verb = exists.rowCount ? 'ALTER' : 'CREATE';
  const { rows } = await client.query<{ ddl: string }>(
    `SELECT format('%s ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', $1::text, $2::text, $3::text) AS ddl`,
    [verb, APP_ROLE, password],
  );
  await client.query(rows[0]!.ddl);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
}
