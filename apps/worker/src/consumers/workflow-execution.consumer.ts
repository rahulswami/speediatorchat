import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowExecutionStatus } from '@speediator/prisma';

export const WORKFLOW_EXECUTION_QUEUE = 'workflow-execution';

interface WorkflowNode {
  id: string;
  type: 'trigger' | 'condition' | 'action' | 'wait';
  config: Record<string, unknown>;
}

@Processor(WORKFLOW_EXECUTION_QUEUE)
export class WorkflowExecutionConsumer extends WorkerHost {
  private readonly logger = new Logger(WorkflowExecutionConsumer.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ workflowId: string; contactId: string; triggeredBy: string; triggerData?: object }>) {
    const { workflowId, contactId, triggeredBy, triggerData } = job.data;

    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow || workflow.status !== 'ACTIVE') {
      this.logger.warn(`Workflow ${workflowId} is not active, skipping`);
      return;
    }

    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return;

    const execution = await this.prisma.workflowExecution.create({
      data: { workflowId, contactId, triggeredBy, status: WorkflowExecutionStatus.RUNNING },
    });

    const nodes = (workflow.nodes as unknown as WorkflowNode[]) ?? [];
    let success = true;

    for (const node of nodes) {
      try {
        await this.executeNode(node, contact, triggerData ?? {});
        await this.prisma.workflowExecStep.create({
          data: { executionId: execution.id, nodeId: node.id, status: 'COMPLETED', output: {} },
        });
      } catch (err) {
        this.logger.error(`Workflow ${workflowId} node ${node.id} failed: ${err}`);
        await this.prisma.workflowExecStep.create({
          data: { executionId: execution.id, nodeId: node.id, status: 'FAILED', output: { error: String(err) } },
        });
        success = false;
        break;
      }
    }

    await this.prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: success ? WorkflowExecutionStatus.COMPLETED : WorkflowExecutionStatus.FAILED,
        completedAt: new Date(),
      },
    });
  }

  private async executeNode(node: WorkflowNode, contact: { id: string; optedIn: boolean }, _triggerData: object) {
    switch (node.type) {
      case 'action': {
        const actionType = node.config.action as string;
        if (actionType === 'add_tag') {
          const tagId = node.config.tagId as string;
          if (tagId) {
            await this.prisma.contactTagMap.upsert({
              where: { contactId_tagId: { contactId: contact.id, tagId } },
              create: { contactId: contact.id, tagId },
              update: {},
            });
          }
        } else if (actionType === 'update_attribute') {
          const key = node.config.key as string;
          const value = node.config.value as string;
          if (key) {
            const attr = await this.prisma.contactAttribute.findFirst({
              where: { contactId: contact.id, key },
            });
            const orgAttr = await this.prisma.contact.findUnique({ where: { id: contact.id }, select: { organizationId: true } });
            if (attr) {
              await this.prisma.contactAttribute.update({ where: { id: attr.id }, data: { value } });
            } else if (orgAttr) {
              await this.prisma.contactAttribute.create({ data: { contactId: contact.id, organizationId: orgAttr.organizationId, key, value } });
            }
          }
        }
        // send_template action: checked for opt-in, delegated to WhatsApp service in real impl
        if (actionType === 'send_template' && !contact.optedIn) {
          throw new Error('Contact has opted out; skipping send action');
        }
        break;
      }
      case 'wait':
        // In a real implementation this would delay using BullMQ delayed jobs
        break;
      default:
        break;
    }
  }
}
