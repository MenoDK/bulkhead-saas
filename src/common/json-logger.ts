import type { LoggerService } from '@nestjs/common';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

/** One JSON object per line: trivially ingestible by any log pipeline. */
export class JsonLogger implements LoggerService {
  private readonly threshold: number;

  constructor(level: Level = 'info') {
    this.threshold = LEVELS.indexOf(level);
  }

  private write(level: Level, message: unknown, context?: string, extra?: string): void {
    if (LEVELS.indexOf(level) < this.threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      context,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      ...(extra ? { stack: extra } : {}),
    });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }
  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
}
