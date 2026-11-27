import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus } from '@speediator/prisma';
import { audienceWhere } from '@speediator/types';

export const CAMPAIGN_FANOUT_QUEUE = 'campaign-fanout';
export const CAMPAIGN_SEND_QUEUE = 'campaign-send';

@Processor(CAMPAIGN_FANOUT_QUEUE)
export class CampaignFanOutConsumer extends WorkerHost {
  private readonly logger = new Logger(CampaignFanOutConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CAMPAIGN_SEND_QUEUE) private readonly sendQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ campaignId: string; organizationId: string }>) {
    const { campaignId, organizationId } = job.data;

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
    });
    if (!campaign || campaign.status !== CampaignStatus.RUNNING) {
      this.logger.warn(`Campaign ${campaignId} not in RUNNING state, skipping fan-out`);
      return;
    }

    const contacts = await this.prisma.contact.findMany({
      where: audienceWhere(organizationId, campaign.audienceFilter),
      select: { id: true },
    });

    // Nothing to send would otherwise leave the campaign RUNNING forever: completion is
    // normally detected by the last send job.
    if (contacts.length === 0) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
      });
      this.logger.warn(`Campaign ${campaignId}: no opted-in contacts match the audience`);
      return;
    }

    // Upsert campaign contacts and enqueue per-contact send jobs
    for (const contact of contacts) {
      await this.prisma.campaignContact.upsert({
        where: { campaignId_contactId: { campaignId, contactId: contact.id } },
        create: { campaignId, contactId: contact.id },
        update: {},
      });
      await this.sendQueue.add('send', { campaignId, contactId: contact.id, organizationId });
    }

    this.logger.log(`Campaign ${campaignId}: enqueued ${contacts.length} contacts`);
  }
}
