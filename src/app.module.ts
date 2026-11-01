import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { CryptoModule } from './common/crypto/crypto.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { BillingModule } from './modules/billing/billing.module';
import { HealthModule } from './modules/health/health.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ResourcesModule } from './modules/resources/resources.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CryptoModule,
    ObservabilityModule,
    IdentityModule,
    AuditModule,
    IdempotencyModule,
    OutboxModule,
    RealtimeModule,
    HealthModule,
    TenancyModule,
    ResourcesModule,
    BillingModule,
    WebhooksModule,
  ],
  providers: [
    // Order matters: authenticate first, then authorize. Both are global, so a new route is protected by default.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
