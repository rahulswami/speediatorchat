import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignContactStatus, CampaignStatus } from '@speediator/prisma';
import { WhatsAppApiError, WhatsAppClient, decryptToken } from '@speediator/whatsapp';
import { ConversationsService } from '../conversations/conversations.service';
import { ConfigService } from '@nestjs/config';

export const CAMPAIGN_SEND_QUEUE = 'campaign-send';

@Processor(CAMPAIGN_SEND_QUEUE)
export class CampaignSendConsumer extends WorkerHost {
  private readonly logger = new Logger(CampaignSendConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly conversations: ConversationsService,
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

    // Re-checked at send time: Meta can pause a template, or the number can be disconnected,
    // after the campaign was created.
    const blocker =
      campaign.template.status !== 'APPROVED'
        ? `Template "${campaign.template.name}" is ${campaign.template.status.toLowerCase()} in Meta`
        : campaign.whatsappAccount.status !== 'CONNECTED'
          ? 'WhatsApp number is not connected'
          : null;
    if (blocker) {
      await this.prisma.campaignContact.update({
        where: { id: campaignContact.id },
        data: { status: CampaignContactStatus.FAILED, error: blocker },
      });
    } else {
      try {
        const encKey = this.config.get<string>('WHATSAPP_TOKEN_ENCRYPTION_KEY')!;
        const plainToken = decryptToken(
          { iv: campaign.whatsappAccount.iv, authTag: campaign.whatsappAccount.authTag, encryptedToken: campaign.whatsappAccount.encryptedToken },
          encKey,
        );
        const client = new WhatsAppClient(this.config.get<string>('WHATSAPP_API_VERSION') ?? 'v20.0');
        const result = await client.sendTemplate({
          phoneNumberId: campaign.whatsappAccount.phoneNumberId,
          accessToken: plainToken,
          to: contact.phone,
          templateName: campaign.template.name,
          languageCode: campaign.template.language,
          components: [],
        });
        const metaMessageId = result.messages?.[0]?.id ?? null;
        const sentAt = new Date();

        await this.prisma.campaignContact.update({
          where: { id: campaignContact.id },
          data: { status: CampaignContactStatus.SENT, sentAt, metaMessageId },
        });
        await this.recordInInbox(organizationId, campaign, contact.id, metaMessageId, sentAt);
      } catch (err) {
        this.logger.error(`Campaign send failed for contact ${contactId}: ${describeSendError(err)}`);
        await this.prisma.campaignContact.update({
          where: { id: campaignContact.id },
          data: { status: CampaignContactStatus.FAILED, error: describeSendError(err) },
        });
      }
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

  /** Shows the campaign message in the customer's inbox thread, so replies have context. */
  private async recordInInbox(
    organizationId: string,
    campaign: { whatsappAccountId: string; template: { name: string; language: string } },
    contactId: string,
    metaMessageId: string | null,
    sentAt: Date,
  ) {
    const conversation = await this.conversations.findOrCreate(
      { organizationId, contactId, whatsappAccountId: campaign.whatsappAccountId },
      'RESOLVED',
    );
    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        organizationId,
        direction: 'OUTBOUND',
        type: 'template',
        content: { templateName: campaign.template.name, language: campaign.template.language },
        metaMessageId,
        status: 'SENT',
        sentAt,
        createdAt: sentAt,
      },
    });
    await this.conversations.touch(conversation.id, conversation.lastMessageAt, sentAt);
  }
}

function describeSendError(err: unknown): string {
  if (err instanceof WhatsAppApiError) {
    const meta = (err.body as { error?: { message?: string; error_user_msg?: string } }).error;
    return meta?.error_user_msg ?? meta?.message ?? `Meta returned HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}
