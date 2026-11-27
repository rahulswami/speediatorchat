import { Module } from '@nestjs/common';
import { whatsAppOnboardingClient } from '@speediator/whatsapp';
import { WhatsappAccountsService } from './whatsapp-accounts.service';
import { WhatsappAccountsController } from './whatsapp-accounts.controller';
import { EmbeddedSignupService, WHATSAPP_ONBOARDING_CLIENT } from './embedded-signup.service';
import { ConnectionCheckService } from './connection-check.service';

@Module({
  providers: [
    WhatsappAccountsService,
    EmbeddedSignupService,
    ConnectionCheckService,
    { provide: WHATSAPP_ONBOARDING_CLIENT, useValue: whatsAppOnboardingClient },
  ],
  controllers: [WhatsappAccountsController],
  exports: [WhatsappAccountsService],
})
export class WhatsappAccountsModule {}
