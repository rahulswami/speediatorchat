import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowStatus } from '@speediator/prisma';

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, userId: string, data: {
    name: string;
    triggerType: string;
    triggerConfig?: object;
    nodes?: unknown[];
    edges?: unknown[];
  }) {
    return this.prisma.workflow.create({
      data: {
        organizationId,
        createdBy: userId,
        name: data.name,
        triggerType: data.triggerType,
        triggerConfig: (data.triggerConfig ?? {}) as object,
        nodes: (data.nodes ?? []) as object[],
        edges: (data.edges ?? []) as object[],
      },
    });
  }

  async list(organizationId: string) {
    return this.prisma.workflow.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(organizationId: string, id: string) {
    const workflow = await this.prisma.workflow.findFirst({ where: { id, organizationId } });
    if (!workflow) throw new NotFoundException('Workflow not found');
    return workflow;
  }

  async update(organizationId: string, id: string, data: {
    name?: string;
    triggerType?: string;
    triggerConfig?: object;
    nodes?: unknown[];
    edges?: unknown[];
  }) {
    const workflow = await this.get(organizationId, id);
    if (workflow.status === WorkflowStatus.ACTIVE) {
      throw new BadRequestException('Deactivate the workflow before editing');
    }
    return this.prisma.workflow.update({
      where: { id },
      data: {
        name: data.name,
        triggerType: data.triggerType,
        triggerConfig: data.triggerConfig as object | undefined,
        nodes: data.nodes as object[] | undefined,
        edges: data.edges as object[] | undefined,
      },
    });
  }

  async publish(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.workflow.update({
      where: { id },
      data: { status: WorkflowStatus.ACTIVE },
    });
  }

  async deactivate(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.workflow.update({
      where: { id },
      data: { status: WorkflowStatus.PAUSED },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.get(organizationId, id);
    await this.prisma.workflow.delete({ where: { id } });
  }

  async listExecutions(organizationId: string, workflowId: string) {
    await this.get(organizationId, workflowId);
    return this.prisma.workflowExecution.findMany({
      where: { workflowId },
      include: { contact: { select: { id: true, name: true, phone: true } } },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }
}
