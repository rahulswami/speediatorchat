import { Module } from '@nestjs/common';
import { WhatsappAccountsService } from './whatsapp-accounts.service';
import { WhatsappAccountsController } from './whatsapp-accounts.controller';

@Module({
  providers: [WhatsappAccountsService],
  controllers: [WhatsappAccountsController],
  exports: [WhatsappAccountsService],
})
export class WhatsappAccountsModule {}
