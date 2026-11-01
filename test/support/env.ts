/** Loaded before every e2e file (jest `setupFiles`): configuration for a throw-away Postgres. */
const owner = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:25433/app');
const app = new URL(owner.toString());
app.username = 'app_user';
app.password = 'app_user_test_password';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  MIGRATION_DATABASE_URL: owner.toString(),
  DATABASE_URL: app.toString(),
  APP_DB_PASSWORD: 'app_user_test_password',
  AUTO_MIGRATE: 'false',
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234',
  PASSWORD_SCRYPT_LOG2_N: '10', // fast hashing in tests; production enforces >= 14
  PAYMENT_WEBHOOK_SECRETS: 'whsec_test_primary,whsec_test_previous',
  AUDIT_EXPORT_SECRET: 'audit-export-secret-audit-export-secret',
  SECRETS_ENCRYPTION_KEY: '1f'.repeat(32), // 32 bytes as hex: a valid AES-256 key, deliberately low-entropy test data,
  OUTBOX_WORKER: 'false', // tests drive the worker by hand with tick()
  OUTBOX_LEASE_SECONDS: '30',
  ALLOW_PRIVATE_WEBHOOK_TARGETS: 'true',
  AUTH_IP_LIMIT: '100000',
  AUTH_ACCOUNT_LIMIT: '10',
  REGISTER_IP_LIMIT: '100000',
  REFUND_APPROVAL_THRESHOLD_CENTS: '10000',
});
delete process.env.PAYMENT_PROVIDER_API_URL;
delete process.env.METRICS_TOKEN;
