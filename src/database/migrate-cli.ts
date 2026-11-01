import { parseEnv } from '../config/env';
import { migrate } from './migrator';

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const applied = await migrate({
    ownerUrl: env.MIGRATION_DATABASE_URL,
    appRolePassword: env.APP_DB_PASSWORD,
    log: (m) => console.log(m),
  });
  console.log(applied.length ? `Applied ${applied.length} migration(s)` : 'Database is up to date');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
