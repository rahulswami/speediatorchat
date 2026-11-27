import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampaignStatus } from '@speediator/prisma';

export const CAMPAIGN_FANOUT_QUEUE = 'campaign-fanout';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CAMPAIGN_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  async create(organizationId: string, userId: string, data: {
    name: string;
    whatsappAccountId: string;
    templateId: string;
    audienceFilter?: object;
    variableMap?: object;
    scheduledAt?: string;
  }) {
    await this.verifyAccount(organizationId, data.whatsappAccountId);
    await this.verifyTemplate(organizationId, data.templateId, data.whatsappAccountId);
    return this.prisma.campaign.create({
      data: {
        organizationId,
        createdBy: userId,
        name: data.name,
        whatsappAccountId: data.whatsappAccountId,
        templateId: data.templateId,
        audienceFilter: data.audienceFilter ?? {},
        variableMap: data.variableMap ?? {},
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
    });
  }

  async list(organizationId: string) {
    return this.prisma.campaign.findMany({
      where: { organizationId },
      include: {
        template: { select: { name: true, language: true, category: true } },
        _count: { select: { contacts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(organizationId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, organizationId },
      include: {
        template: { select: { name: true, language: true, category: true } },
        _count: { select: { contacts: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async getAnalytics(organizationId: string, id: string) {
    await this.get(organizationId, id);
    const stats = await this.prisma.campaignContact.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: true,
    });
    const result: Record<string, number> = {
      PENDING: 0, SENT: 0, FAILED: 0, SKIPPED_OPTED_OUT: 0, SKIPPED_NO_SESSION: 0,
    };
    for (const s of stats) result[s.status] = s._count;
    return result;
  }

  async update(organizationId: string, id: string, data: {
    name?: string;
    audienceFilter?: object;
    variableMap?: object;
    scheduledAt?: string;
  }) {
    const campaign = await this.get(organizationId, id);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Only draft campaigns can be edited');
    }
    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: data.name,
        audienceFilter: data.audienceFilter,
        variableMap: data.variableMap,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      },
    });
  }

  async remove(organizationId: string, id: string) {
    const campaign = await this.get(organizationId, id);
    if (!['DRAFT', 'FAILED', 'COMPLETED'].includes(campaign.status)) {
      throw new BadRequestException('Cannot delete a running campaign');
    }
    await this.prisma.campaign.delete({ where: { id } });
  }

  async getAudienceCount(organizationId: string, id: string) {
    const campaign = await this.get(organizationId, id);
    const filter = campaign.audienceFilter as Record<string, unknown>;
    const tagIds = (filter.tagIds as string[] | undefined) ?? [];

    let count: number;
    if (tagIds.length > 0) {
      count = await this.prisma.contact.count({
        where: { organizationId, optedIn: true, tagMap: { some: { tagId: { in: tagIds } } } },
      });
    } else {
      count = await this.prisma.contact.count({
        where: { organizationId, optedIn: true },
      });
    }
    return { count };
  }

  async launch(organizationId: string, id: string) {
    const campaign = await this.get(organizationId, id);
    if (!['DRAFT', 'PAUSED'].includes(campaign.status)) {
      throw new BadRequestException('Campaign cannot be launched from its current status');
    }
    await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.RUNNING, startedAt: new Date() },
    });
    await this.fanoutQueue.add('fanout', { campaignId: id, organizationId });
    return { status: 'running' };
  }

  async pause(organizationId: string, id: string) {
    const campaign = await this.get(organizationId, id);
    if (campaign.status !== CampaignStatus.RUNNING) {
      throw new BadRequestException('Campaign is not running');
    }
    await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.PAUSED },
    });
    return { status: 'paused' };
  }

  private async verifyAccount(organizationId: string, whatsappAccountId: string) {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id: whatsappAccountId, organizationId },
    });
    if (!account) throw new ForbiddenException('WhatsApp account not found');
  }

  private async verifyTemplate(organizationId: string, templateId: string, whatsappAccountId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!template) throw new ForbiddenException('Template not found');
    // Templates belong to one WhatsApp account; Meta rejects them from any other number.
    if (template.whatsappAccountId !== whatsappAccountId) {
      throw new BadRequestException('This template belongs to a different WhatsApp number');
    }
    if (template.status !== 'APPROVED') throw new BadRequestException('Only approved templates can be used in campaigns');
  }
}
