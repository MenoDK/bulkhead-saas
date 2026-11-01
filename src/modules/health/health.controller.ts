import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import { type AuthedRequest, Public } from '../../common/auth';
import { notFound, unauthorized } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { MetricsService } from '../observability/metrics.service';

@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly metrics: MetricsService,
  ) {}

  /** Liveness: the process is up. Must not depend on anything external, or a DB blip restarts every pod. */
  @Public()
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: can this instance serve traffic right now? */
  @Public()
  @Get('health/ready')
  async ready() {
    if (!(await this.db.ping()))
      throw new ServiceUnavailableException({ status: 'unavailable', checks: { database: 'down' } });
    return { status: 'ok', checks: { database: 'up' } };
  }

  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async scrape(@Req() req: AuthedRequest) {
    const expected = this.env.METRICS_TOKEN;
    if (!expected) {
      if (this.env.NODE_ENV === 'production') throw notFound('Route');
    } else {
      const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      const want = Buffer.from(expected);
      if (given.length !== want.length || !timingSafeEqual(given, want))
        throw unauthorized('INVALID_TOKEN', 'Invalid metrics token');
    }
    return this.metrics.registry.metrics();
  }
}
