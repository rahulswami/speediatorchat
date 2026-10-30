import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService, WEBHOOK_QUEUE } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

@Module({
  imports: [BullModule.registerQueue({ name: WEBHOOK_QUEUE })],
  providers: [WebhooksService, WebhookSignatureGuard],
  controllers: [WebhooksController],
  exports: [],
})
export class WebhooksModule {}
