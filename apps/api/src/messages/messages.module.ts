import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { WhatsappAccountsModule } from '../whatsapp-accounts/whatsapp-accounts.module';

@Module({
  imports: [WhatsappAccountsModule],
  providers: [MessagesService],
  controllers: [MessagesController],
  exports: [MessagesService],
})
export class MessagesModule {}
