import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { validateEnv } from './config/env.validation';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { ContactsService } from './contacts/contacts.service';
import { CoexistenceService } from './coexistence/coexistence.service';
import { ConversationsService } from './conversations/conversations.service';
import { WebhookEventsConsumer } from './consumers/webhook-events.consumer';
import { CampaignFanOutConsumer, CAMPAIGN_FANOUT_QUEUE, CAMPAIGN_SEND_QUEUE } from './consumers/campaign-fanout.consumer';
import { CampaignSendConsumer } from './consumers/campaign-send.consumer';
import { OutboundWebhookDeliveryConsumer, OUTBOUND_WEBHOOK_DELIVERY_QUEUE } from './consumers/outbound-webhook-delivery.consumer';
import { WorkflowExecutionConsumer, WORKFLOW_EXECUTION_QUEUE } from './consumers/workflow-execution.consumer';

const WEBHOOK_QUEUE = 'webhook-events';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue(
      { name: WEBHOOK_QUEUE },
      { name: CAMPAIGN_FANOUT_QUEUE },
      { name: CAMPAIGN_SEND_QUEUE },
      { name: OUTBOUND_WEBHOOK_DELIVERY_QUEUE },
      { name: WORKFLOW_EXECUTION_QUEUE },
    ),
    EventEmitterModule.forRoot(),
    TerminusModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    ContactsService,
    ConversationsService,
    CoexistenceService,
    WebhookEventsConsumer,
    CampaignFanOutConsumer,
    CampaignSendConsumer,
    OutboundWebhookDeliveryConsumer,
    WorkflowExecutionConsumer,
  ],
})
export class AppModule {}
