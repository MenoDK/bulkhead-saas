import { migrate } from '../../src/database/migrator';

/**
 * Runs once before the e2e suite so that EVERY spec file can be run on its own against a fresh database
 * (a spec used to depend on an earlier file having created the schema).
 */
export default async function globalSetup(): Promise<void> {
  await migrate({
    ownerUrl: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:25433/app',
    appRolePassword: 'app_user_test_password',
  });
}
