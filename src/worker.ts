import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger';
import { ENV, type Env } from './config/env';

/**
 * Stand-alone outbox worker: the same code, no HTTP listener. Run N of them next to M API replicas
 * (API replicas with OUTBOX_WORKER=false); FOR UPDATE SKIP LOCKED keeps them from colliding.
 *
 * With no HTTP server nothing keeps the process alive: the poll timer is unref'd on purpose (so it never blocks a
 * shutdown), and neither a pending promise nor a signal listener holds Node's event loop open, so the process
 * would exit with code 0 right after starting. A deliberately ref'd handle keeps it running until SIGTERM/SIGINT,
 * then the application is closed, which lets the in-flight batch finish before the pool closes.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  app.useLogger(new JsonLogger(env.LOG_LEVEL));
  if (!env.OUTBOX_WORKER) throw new Error('worker.ts needs OUTBOX_WORKER=true');

  const logger = new Logger('Worker');
  const keepAlive = setInterval(() => undefined, 60_000); // ref'd on purpose, see above
  logger.log('outbox worker running');
  const signal = await new Promise<NodeJS.Signals>((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  logger.log(`received ${signal}, draining`);
  clearInterval(keepAlive);
  await app.close();
}

main().catch((error: unknown) => {
  new Logger('Worker').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
