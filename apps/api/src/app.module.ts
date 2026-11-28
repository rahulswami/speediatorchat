import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { MembersModule } from './members/members.module';
import { InvitesModule } from './invites/invites.module';
import { HealthModule } from './health/health.module';
import { WhatsappAccountsModule } from './whatsapp-accounts/whatsapp-accounts.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { TemplatesModule } from './templates/templates.module';
import { InboxModule } from './inbox/inbox.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { BillingModule } from './billing/billing.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { OutboundWebhooksModule } from './outbound-webhooks/outbound-webhooks.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { OverviewModule } from './overview/overview.module';
import { LogRedactInterceptor } from './auth/interceptors/log-redact.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 20 },
      { name: 'medium', ttl: 60_000, limit: 500 },
    ]),
    PrismaModule,
    RedisModule,
    AuthModule,
    OrganizationsModule,
    MembersModule,
    InvitesModule,
    HealthModule,
    WhatsappAccountsModule,
    WebhooksModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    TemplatesModule,
    InboxModule,
    CampaignsModule,
    WorkflowsModule,
    BillingModule,
    ApiKeysModule,
    OutboundWebhooksModule,
    IntegrationsModule,
    OverviewModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LogRedactInterceptor }],
})
export class AppModule {}
