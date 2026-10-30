import { Module } from '@nestjs/common';
import { InboxGateway } from './inbox.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [InboxGateway],
  exports: [InboxGateway],
})
export class InboxModule {}
