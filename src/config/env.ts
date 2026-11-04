import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/**
 * All configuration is validated once at startup. A missing or malformed value stops the process
 * with a readable message instead of surfacing later as a confusing runtime error.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Connection used by the application: the unprivileged `app_user` role (subject to RLS). */
  DATABASE_URL: z.string().min(1),
  /** Connection used ONLY to run migrations: the schema owner. */
  MIGRATION_DATABASE_URL: z.string().min(1),
  /** Password given to `app_user` when the migrator creates the role. */
  APP_DB_PASSWORD: z.string().min(8),
  AUTO_MIGRATE: bool.default(true),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .default(60 * 60 * 24 * 14),
  /** log2 of the scrypt cost parameter N. 15 => N = 32768. */
  PASSWORD_SCRYPT_LOG2_N: z.coerce.number().int().min(10).max(20).default(15),

  /** 32-byte key (64 hex chars) used to encrypt secrets at rest (AES-256-GCM). Generate: openssl rand -hex 32 */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_ENCRYPTION_KEY must be 64 hex characters'),

  /** Auth attempts allowed per 15 minutes: per client IP, and per (e-mail + IP) pair. */
  AUTH_IP_LIMIT: z.coerce.number().int().min(1).default(100),
  AUTH_ACCOUNT_LIMIT: z.coerce.number().int().min(1).default(10),
  /** New workspaces allowed per hour per client IP. */
  REGISTER_IP_LIMIT: z.coerce.number().int().min(1).default(20),

  /** Shared secret(s) for inbound payment webhooks; comma-separated to allow rotation. */
  PAYMENT_WEBHOOK_SECRETS: z.string().min(16),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).default(300),
  /**
   * Optional "reverse confirmation" for inbound payment webhooks: when set, a notification is treated as a
   * POINTER and the real payment state is fetched from the provider API (the webhook body is never trusted).
   */
  PAYMENT_PROVIDER_API_URL: z.url().optional(),
  PAYMENT_PROVIDER_API_TOKEN: z.string().min(8).optional(),
  /** HMAC key used to sign audit exports. */
  AUDIT_EXPORT_SECRET: z.string().min(32),

  /** Refunds above this amount (minor units) need an owner/admin. */
  REFUND_APPROVAL_THRESHOLD_CENTS: z.coerce.number().int().min(0).default(10_000),

  OUTBOX_WORKER: bool.default(true),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(1000),
  /** When set, the worker rewrites this file after every poll that succeeded; the container health check reads its age. */
  WORKER_HEARTBEAT_FILE: z.string().min(1).optional(),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).default(60),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  OUTBOX_DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  /** Set to true ONLY in tests/dev: allows outbound webhooks to loopback/private addresses. */
  ALLOW_PRIVATE_WEBHOOK_TARGETS: bool.default(false),

  /** Number of reverse proxies in front of the app (so req.ip is the real client). 0 = none. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Bearer token required by GET /metrics. Unset: open outside production, disabled in production. */
  METRICS_TOKEN: z.string().min(16).optional(),

  /** Comma-separated list of allowed browser origins; empty = CORS disabled. */
  CORS_ORIGINS: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production') {
    if (env.ALLOW_PRIVATE_WEBHOOK_TARGETS) {
      throw new Error('ALLOW_PRIVATE_WEBHOOK_TARGETS must not be enabled in production (SSRF risk)');
    }
    if (env.PASSWORD_SCRYPT_LOG2_N < 14) {
      throw new Error('PASSWORD_SCRYPT_LOG2_N must be at least 14 in production');
    }
  }
  return env;
}

export const ENV = Symbol('ENV');
