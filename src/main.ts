import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { requestId } from './common/request-context';
import { JsonLogger } from './common/json-logger';
import { ENV, type Env } from './config/env';
import { migrate } from './database/migrator';

async function bootstrap(): Promise<void> {
  // rawBody: signature verification needs the exact bytes the sender signed, not a re-serialised object.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  const env = app.get<Env>(ENV);

  app.useLogger(new JsonLogger(env.LOG_LEVEL));
  if (env.AUTO_MIGRATE) {
    const applied = await migrate({
      ownerUrl: env.MIGRATION_DATABASE_URL,
      appRolePassword: env.APP_DB_PASSWORD,
    });
    if (applied.length) new Logger('Migrator').log(`applied ${applied.length} migration(s)`);
  }

  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(requestId);
  const origins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length)
    app.enableCors({
      origin: origins,
      credentials: false,
      exposedHeaders: ['x-request-id', 'idempotent-replayed', 'retry-after'],
    });
  app.enableShutdownHooks(); // SIGTERM -> close HTTP, drain the outbox batch, close the pool

  await app.listen(env.PORT, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
