import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampaignStatus, CampaignContactStatus } from '@speediator/prisma';
import {
  audienceWhere,
  parseTemplateVariables,
  variableProblems,
  type AudienceFilter,
  type TemplateVariables,
} from '@speediator/types';

export const CAMPAIGN_FANOUT_QUEUE = 'campaign-fanout';

export const RECIPIENT_FILTERS = ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped'] as const;
type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

// "sent" counts everything that left, including what was later delivered or read.
const RECIPIENT_STATUSES: Record<RecipientFilter, CampaignContactStatus[]> = {
  pending: ['PENDING'],
  sent: ['SENT', 'DELIVERED', 'READ'],
  delivered: ['DELIVERED', 'READ'],
  read: ['READ'],
  failed: ['FAILED'],
  skipped: ['SKIPPED_OPTED_OUT', 'SKIPPED_NO_SESSION'],
};

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
    audienceFilter?: AudienceFilter;
    variableMap?: TemplateVariables;
    scheduledAt?: string;
  }) {
    await this.verifyAccount(organizationId, data.whatsappAccountId);
    const template = await this.verifyTemplate(organizationId, data.templateId, data.whatsappAccountId);
    assertVariablesComplete(template.components, data.variableMap ?? { values: {} });
    return this.prisma.campaign.create({
      data: {
        organizationId,
        createdBy: userId,
        name: data.name,
        whatsappAccountId: data.whatsappAccountId,
        templateId: data.templateId,
        audienceFilter: data.audienceFilter ?? { mode: 'all' },
        variableMap: data.variableMap ?? { values: {} },
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
        template: { select: { name: true, language: true, category: true, components: true } },
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
      where: { campaignId: id, campaign: { organizationId } },
      _count: true,
    });
    const byStatus = Object.fromEntries(stats.map((s) => [s.status, s._count])) as Partial<
      Record<CampaignContactStatus, number>
    >;
    const count = (filter: RecipientFilter) =>
      RECIPIENT_STATUSES[filter].reduce((sum, st) => sum + (byStatus[st] ?? 0), 0);

    const total = stats.reduce((sum, s) => sum + s._count, 0);
    const sent = count('sent');
    const delivered = count('delivered');
    const read = count('read');
    const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
    return {
      total,
      pending: count('pending'),
      sent,
      delivered,
      read,
      failed: count('failed'),
      skipped: count('skipped'),
      deliveryRate: pct(delivered, sent),
      readRate: pct(read, delivered),
    };
  }

  async listRecipients(
    organizationId: string,
    id: string,
    opts: { status?: RecipientFilter; page: number; limit: number },
  ) {
    await this.get(organizationId, id);
    const where = {
      campaignId: id,
      campaign: { organizationId },
      ...(opts.status ? { status: { in: RECIPIENT_STATUSES[opts.status] } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.campaignContact.findMany({
        where,
        orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
        select: {
          id: true,
          status: true,
          error: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          contact: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.campaignContact.count({ where }),
    ]);
    return { items, total, page: opts.page, limit: opts.limit };
  }

  async countAudience(organizationId: string, filter: AudienceFilter) {
    return { count: await this.prisma.contact.count({ where: audienceWhere(organizationId, filter) }) };
  }

  async update(organizationId: string, id: string, data: {
    name?: string;
    audienceFilter?: AudienceFilter;
    variableMap?: TemplateVariables;
    scheduledAt?: string;
  }) {
    const campaign = await this.get(organizationId, id);
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Only draft campaigns can be edited');
    }
    if (data.variableMap) assertVariablesComplete(campaign.template.components, data.variableMap);
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
    return this.countAudience(organizationId, campaign.audienceFilter as AudienceFilter);
  }

  async launch(organizationId: string, id: string) {
    const campaign = await this.get(organizationId, id);
    if (!['DRAFT', 'PAUSED'].includes(campaign.status)) {
      throw new BadRequestException('Campaign cannot be launched from its current status');
    }
    // Campaigns made before variables could be set would fail for every recipient.
    assertVariablesComplete(campaign.template.components, parseTemplateVariables(campaign.variableMap));
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
    return template;
  }
}

function assertVariablesComplete(components: unknown, vars: TemplateVariables) {
  const problems = variableProblems(components, vars);
  if (problems.length) throw new BadRequestException(problems.join('. '));
}
