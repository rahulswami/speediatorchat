import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHmac, createHash, randomBytes } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const OUTBOUND_WEBHOOK_QUEUE = 'outbound-webhook-delivery';

@Injectable()
export class OutboundWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OUTBOUND_WEBHOOK_QUEUE) private readonly deliveryQueue: Queue,
  ) {}

  async create(organizationId: string, data: { url: string; events: string[] }) {
    const secret = randomBytes(32).toString('hex');
    const secretHash = createHash('sha256').update(secret).digest('hex');
    const hook = await this.prisma.outboundWebhook.create({
      data: { organizationId, url: data.url, events: data.events, secretHash },
    });
    return { ...hook, secret };
  }

  async list(organizationId: string) {
    return this.prisma.outboundWebhook.findMany({
      where: { organizationId },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
  }

  async remove(organizationId: string, id: string) {
    const hook = await this.prisma.outboundWebhook.findFirst({ where: { id, organizationId } });
    if (!hook) throw new NotFoundException('Webhook not found');
    await this.prisma.outboundWebhook.delete({ where: { id } });
  }

  async dispatch(organizationId: string, event: string, payload: object) {
    const hooks = await this.prisma.outboundWebhook.findMany({
      where: { organizationId, active: true, events: { has: event } },
    });
    for (const hook of hooks) {
      await this.deliveryQueue.add('deliver', { hookId: hook.id, event, payload });
    }
  }
}
