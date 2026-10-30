import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationType } from '@speediator/prisma';

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.integration.findMany({ where: { organizationId } });
  }

  async connect(organizationId: string, type: IntegrationType, config: Record<string, unknown>) {
    return this.prisma.integration.upsert({
      where: { organizationId_type: { organizationId, type } },
      create: { organizationId, type, config: config as object, status: 'connected' },
      update: { config: config as object, status: 'connected' },
    });
  }

  async disconnect(organizationId: string, type: IntegrationType) {
    const integration = await this.prisma.integration.findUnique({
      where: { organizationId_type: { organizationId, type } },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    return this.prisma.integration.update({
      where: { organizationId_type: { organizationId, type } },
      data: { status: 'disconnected', config: {} },
    });
  }
}
