import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { createHmac, createHash } from 'crypto';

export const OUTBOUND_WEBHOOK_DELIVERY_QUEUE = 'outbound-webhook-delivery';

@Processor(OUTBOUND_WEBHOOK_DELIVERY_QUEUE)
export class OutboundWebhookDeliveryConsumer extends WorkerHost {
  private readonly logger = new Logger(OutboundWebhookDeliveryConsumer.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ hookId: string; event: string; payload: object }>) {
    const { hookId, event, payload } = job.data;

    const hook = await this.prisma.outboundWebhook.findUnique({ where: { id: hookId } });
    if (!hook || !hook.active) return;

    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });

    // Sign with HMAC-SHA256 using the stored hash to derive signature
    const sig = createHmac('sha256', hook.secretHash).update(body).digest('hex');

    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Speediator-Signature': `sha256=${sig}`,
        'X-Speediator-Event': event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Webhook delivery failed: ${res.status} ${res.statusText}`);
    }

    this.logger.log(`Delivered ${event} to ${hook.url} — ${res.status}`);
  }
}
