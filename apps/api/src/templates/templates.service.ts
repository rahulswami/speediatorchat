import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappAccountsService } from '../whatsapp-accounts/whatsapp-accounts.service';
import { whatsAppClient } from '@speediator/whatsapp';
import { TemplateStatus, TemplateCategory } from '@speediator/prisma';

export interface CreateTemplateDto {
  whatsappAccountId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  components: object[];
}

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAccountsService: WhatsappAccountsService,
  ) {}

  async list(organizationId: string, status?: TemplateStatus) {
    return this.prisma.template.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(organizationId: string, id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, organizationId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async create(organizationId: string, dto: CreateTemplateDto) {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id: dto.whatsappAccountId, organizationId },
    });
    if (!account) throw new NotFoundException('WhatsApp account not found');

    // Submit to Meta
    const accessToken = await this.waAccountsService.getDecryptedToken(
      organizationId,
      dto.whatsappAccountId,
    );

    let metaTemplateId: string | undefined;
    try {
      const result = await whatsAppClient.createTemplate({
        wabaId: account.wabaId,
        accessToken,
        name: dto.name,
        language: dto.language,
        category: dto.category,
        components: dto.components,
      });
      metaTemplateId = result.id;
    } catch (err) {
      this.logger.warn(`Meta template submit failed: ${String(err)}`);
      // Save locally as PENDING even if Meta submission fails in dev
    }

    return this.prisma.template.create({
      data: {
        organizationId,
        whatsappAccountId: dto.whatsappAccountId,
        name: dto.name,
        language: dto.language,
        category: dto.category,
        components: dto.components,
        metaTemplateId: metaTemplateId ?? null,
        status: 'PENDING',
      },
    });
  }

  async syncFromMeta(organizationId: string, whatsappAccountId: string) {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id: whatsappAccountId, organizationId },
    });
    if (!account) throw new NotFoundException('WhatsApp account not found');

    const accessToken = await this.waAccountsService.getDecryptedToken(
      organizationId,
      whatsappAccountId,
    );

    const { data: metaTemplates } = await whatsAppClient.listTemplates(account.wabaId, accessToken);

    const seen: string[] = [];
    for (const mt of metaTemplates) {
      const t = mt as {
        id: string;
        name: string;
        language: string;
        category: string;
        status: string;
        components: object[];
        rejected_reason?: string;
      };
      const status = toTemplateStatus(t.status);
      const rejectionReason = t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null;
      seen.push(t.id);

      await this.prisma.template.upsert({
        where: { organizationId_name_language: { organizationId, name: t.name, language: t.language } },
        create: {
          organizationId,
          whatsappAccountId,
          metaTemplateId: t.id,
          name: t.name,
          language: t.language,
          category: toTemplateCategory(t.category),
          status,
          components: t.components,
          rejectionReason,
          syncedAt: new Date(),
        },
        update: {
          metaTemplateId: t.id,
          category: toTemplateCategory(t.category),
          status,
          rejectionReason,
          components: t.components,
          syncedAt: new Date(),
        },
      });
    }

    // A template deleted in Meta must stop being sendable here too.
    const { count: removed } = await this.prisma.template.updateMany({
      where: {
        organizationId,
        whatsappAccountId,
        metaTemplateId: { notIn: seen },
        status: { not: 'DISABLED' },
        syncedAt: { not: null },
      },
      data: { status: 'DISABLED', rejectionReason: 'No longer exists in Meta' },
    });

    const templates = await this.prisma.template.findMany({
      where: { organizationId, whatsappAccountId },
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
      select: { id: true, name: true, language: true, category: true, status: true, rejectionReason: true },
    });

    return { synced: seen.length, removed, templates };
  }

  async handleStatusWebhook(data: {
    templateId: string;
    templateName: string;
    status: string;
    reason?: string;
  }) {
    await this.prisma.template.updateMany({
      where: { metaTemplateId: data.templateId },
      data: {
        status: data.status as TemplateStatus,
        rejectionReason: data.reason ?? null,
        syncedAt: new Date(),
      },
    });
  }

  async delete(organizationId: string, id: string) {
    const template = await this.prisma.template.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Template not found');
    await this.prisma.template.delete({ where: { id } });
  }

  async assertApproved(organizationId: string, id: string) {
    const template = await this.prisma.template.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Template not found');
    if (template.status !== 'APPROVED') {
      throw new BadRequestException(`Template is ${template.status}, only APPROVED templates can be sent`);
    }
    return template;
  }
}

// Meta has more template statuses than we store. Anything we don't recognise is treated as
// not sendable, so it can never be used in a campaign by mistake.
export function toTemplateStatus(status: string): TemplateStatus {
  switch (status) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'PAUSED':
      return 'PAUSED';
    case 'DISABLED':
    case 'DELETED':
    case 'PENDING_DELETION':
    case 'ARCHIVED':
    case 'LIMIT_EXCEEDED':
      return 'DISABLED';
    default:
      return 'PENDING';
  }
}

export function toTemplateCategory(category: string): TemplateCategory {
  return category === 'UTILITY' || category === 'AUTHENTICATION' ? category : 'MARKETING';
}
