import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { WhatsappAccountsModule } from '../whatsapp-accounts/whatsapp-accounts.module';

@Module({
  imports: [WhatsappAccountsModule],
  providers: [TemplatesService],
  controllers: [TemplatesController],
  exports: [TemplatesService],
})
export class TemplatesModule {}
