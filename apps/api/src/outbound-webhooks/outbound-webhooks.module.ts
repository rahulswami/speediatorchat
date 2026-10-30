import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboundWebhooksService, OUTBOUND_WEBHOOK_QUEUE } from './outbound-webhooks.service';
import { OutboundWebhooksController } from './outbound-webhooks.controller';

@Module({
  imports: [BullModule.registerQueue({ name: OUTBOUND_WEBHOOK_QUEUE })],
  providers: [OutboundWebhooksService],
  controllers: [OutboundWebhooksController],
  exports: [OutboundWebhooksService],
})
export class OutboundWebhooksModule {}
