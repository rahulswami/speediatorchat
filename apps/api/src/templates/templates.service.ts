import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappAccountsService } from '../whatsapp-accounts/whatsapp-accounts.service';
import { whatsAppClient } from '@speediator/whatsapp';
import { TemplateStatus, TemplateCategory } from '@speediator/prisma';
import { buildCreateComponents, type NewTemplateInput } from '@speediator/types';
import { rethrowMetaError } from '../common/meta-error';
import type { UploadedFile } from '../common/uploaded-file';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly waAccountsService: WhatsappAccountsService,
    private readonly config: ConfigService,
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

  async create(organizationId: string, input: NewTemplateInput) {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id: input.whatsappAccountId, organizationId },
    });
    if (!account) throw new NotFoundException('WhatsApp account not found');

    const existing = await this.prisma.template.findFirst({
      where: { organizationId, name: input.name, language: input.language },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`A template named "${input.name}" in ${input.language} already exists. Pick another name.`);
    }

    const components = buildCreateComponents(input);
    const accessToken = await this.waAccountsService.getDecryptedToken(organizationId, account.id);
    // Meta's rejection (bad example, policy, duplicate name in Meta) goes straight back to the user.
    const result = await whatsAppClient
      .createTemplate({
        wabaId: account.wabaId,
        accessToken,
        name: input.name,
        language: input.language,
        category: input.category,
        components,
      })
      .catch(rethrowMetaError('Meta rejected the template'));

    return this.prisma.template.create({
      data: {
        organizationId,
        whatsappAccountId: account.id,
        name: input.name,
        language: input.language,
        category: input.category,
        components: components as object[],
        metaTemplateId: result.id ?? null,
        status: toTemplateStatus((result as { status?: string }).status ?? 'PENDING'),
        syncedAt: new Date(),
      },
    });
  }

  /** Uploads a sample file and returns the handle a media header needs when the template is created. */
  async uploadHeaderSample(organizationId: string, whatsappAccountId: string, file: UploadedFile) {
    const appId = this.config.get<string>('META_APP_ID');
    if (!appId) throw new BadRequestException('Set META_APP_ID on the server to create templates with a media header');
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id: whatsappAccountId, organizationId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('WhatsApp account not found');

    const accessToken = await this.waAccountsService.getDecryptedToken(organizationId, account.id);
    const handle = await whatsAppClient
      .uploadTemplateSample({ appId, accessToken, fileName: file.fileName, fileType: file.fileType, bytes: file.bytes })
      .catch(rethrowMetaError('Meta did not accept the file'));
    return { handle, format: file.format, fileName: file.fileName };
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
    const used = await this.prisma.campaign.count({ where: { organizationId, templateId: template.id } });
    if (used) throw new ConflictException(`This template is used by ${used} campaign${used === 1 ? '' : 's'}. Delete those first.`);
    await this.prisma.template.delete({ where: { id: template.id } });
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
