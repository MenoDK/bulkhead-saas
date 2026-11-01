import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PaymentProviderClient } from './payment-provider.client';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { WebhookEndpointsService } from './webhook-endpoints.service';

@Module({
  imports: [BillingModule],
  providers: [WebhookEndpointsService, PaymentProviderClient],
  controllers: [WebhookEndpointsController, PaymentsWebhookController],
})
export class WebhooksModule {}
