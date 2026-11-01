import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/** One registry per application instance (a global registry breaks when tests build the app twice). */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly outboxDeliveries = new Counter({
    name: 'outbox_deliveries_total',
    help: 'Outbound webhook delivery attempts by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly inboundWebhooks = new Counter({
    name: 'inbound_webhooks_total',
    help: 'Inbound payment webhooks by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
