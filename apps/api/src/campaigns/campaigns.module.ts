import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CampaignsService, CAMPAIGN_FANOUT_QUEUE } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [BullModule.registerQueue({ name: CAMPAIGN_FANOUT_QUEUE })],
  providers: [CampaignsService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
