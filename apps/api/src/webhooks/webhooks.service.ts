import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const WEBHOOK_QUEUE = 'webhook-events';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  async handleIncoming(payload: object): Promise<void> {
    const raw = payload as {
      entry?: Array<{
        id?: string;
        changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }>;
      }>;
    };

    const wabaId = raw.entry?.[0]?.id;
    const phoneNumberId =
      raw.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    // Look up the WhatsApp account by phone number id
    const account = phoneNumberId
      ? await this.prisma.whatsappAccount.findFirst({
          where: { phoneNumberId },
        })
      : null;

    const event = await this.prisma.webhookEvent.create({
      data: {
        organizationId: account?.organizationId ?? '00000000-0000-0000-0000-000000000000',
        whatsappAccountId: account?.id ?? null,
        payload: payload as object,
        status: 'PENDING',
      },
    });

    await this.queue.add('process', { eventId: event.id }, { jobId: event.id });
    this.logger.debug(`Queued webhook event ${event.id} (wabaId=${wabaId})`);
  }
}
