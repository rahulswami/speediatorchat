import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignContactStatus, CampaignStatus } from '@speediator/prisma';
import { WhatsAppClient, decryptToken } from '@speediator/whatsapp';
import { ConfigService } from '@nestjs/config';

export const CAMPAIGN_SEND_QUEUE = 'campaign-send';

@Processor(CAMPAIGN_SEND_QUEUE)
export class CampaignSendConsumer extends WorkerHost {
  private readonly logger = new Logger(CampaignSendConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<{ campaignId: string; contactId: string; organizationId: string }>) {
    const { campaignId, contactId, organizationId } = job.data;

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      include: { template: true, whatsappAccount: true },
    });

    if (!campaign) {
      this.logger.warn(`Campaign ${campaignId} not found`);
      return;
    }

    if (campaign.status === CampaignStatus.PAUSED) {
      this.logger.log(`Campaign ${campaignId} is paused, requeueing later`);
      await job.moveToDelayed(Date.now() + 60_000);
      return;
    }

    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) return;

    const campaignContact = await this.prisma.campaignContact.findFirst({
      where: { campaignId, contactId },
    });
    if (!campaignContact || campaignContact.status !== CampaignContactStatus.PENDING) return;

    if (!contact.optedIn) {
      await this.prisma.campaignContact.update({
        where: { id: campaignContact.id },
        data: { status: CampaignContactStatus.SKIPPED_OPTED_OUT },
      });
      return;
    }

    try {
      const encKey = this.config.get<string>('WHATSAPP_TOKEN_ENCRYPTION_KEY')!;
      const plainToken = decryptToken(
        { iv: campaign.whatsappAccount.iv, authTag: campaign.whatsappAccount.authTag, encryptedToken: campaign.whatsappAccount.encryptedToken },
        encKey,
      );
      const client = new WhatsAppClient(this.config.get<string>('WHATSAPP_API_VERSION') ?? 'v20.0');
      await client.sendTemplate({
        phoneNumberId: campaign.whatsappAccount.phoneNumberId,
        accessToken: plainToken,
        to: contact.phone,
        templateName: campaign.template.name,
        languageCode: campaign.template.language,
        components: [],
      });

      await this.prisma.campaignContact.update({
        where: { id: campaignContact.id },
        data: { status: CampaignContactStatus.SENT, sentAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`Campaign send failed for contact ${contactId}: ${err}`);
      await this.prisma.campaignContact.update({
        where: { id: campaignContact.id },
        data: { status: CampaignContactStatus.FAILED, error: String(err) },
      });
    }

    // Mark campaign completed if all contacts processed
    const pending = await this.prisma.campaignContact.count({
      where: { campaignId, status: CampaignContactStatus.PENDING },
    });
    if (pending === 0) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
      });
    }
  }
}
