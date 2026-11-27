import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const WEBHOOK_QUEUE = 'webhook-events';

interface WebhookChange {
  field?: string;
  value?: {
    metadata?: { phone_number_id?: string };
    waba_info?: { waba_id?: string };
  };
}

interface WebhookPayload {
  object?: string;
  entry?: Array<{ id?: string; time?: number; changes?: WebhookChange[] }>;
}

interface BareValue {
  messaging_product?: string;
  metadata?: { phone_number_id?: string };
  history?: unknown[];
}

/**
 * Meta's reference shows the "history sharing turned off" webhook as a bare value with no
 * entry/changes wrapper. Wrap it so it's routed like every other change.
 */
function normalize(payload: WebhookPayload & BareValue): WebhookPayload {
  if (payload.entry || !payload.history || !payload.metadata?.phone_number_id) return payload;
  const { messaging_product, metadata, history } = payload;
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'history', value: { messaging_product, metadata, history } as WebhookChange['value'] }] }],
  };
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Meta batches several entries and changes into one delivery, possibly for different
   * customers. Each change is stored as its own event so it is routed to the right
   * organization and the consumer handles exactly one change per event.
   */
  async handleIncoming(payload: object): Promise<void> {
    const raw = normalize(payload as WebhookPayload & BareValue);

    for (const entry of raw.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const account = await this.findAccount(entry.id, change);
        if (!account) {
          this.logger.warn(
            `Dropping webhook change "${change.field}" for unknown account (entry ${entry.id})`,
          );
          continue;
        }

        const event = await this.prisma.webhookEvent.create({
          data: {
            organizationId: account.organizationId,
            whatsappAccountId: account.id,
            payload: { object: raw.object, entry: [{ ...entry, changes: [change] }] } as object,
            status: 'PENDING',
          },
        });
        await this.queue.add('process', { eventId: event.id }, { jobId: event.id });
      }
    }
  }

  private async findAccount(entryId: string | undefined, change: WebhookChange) {
    const select = { id: true, organizationId: true };

    const phoneNumberId = change.value?.metadata?.phone_number_id;
    if (phoneNumberId) {
      return this.prisma.whatsappAccount.findFirst({ where: { phoneNumberId }, select });
    }

    // account_update and other account-level fields have no phone number. Meta's examples
    // put the WABA in waba_info; entry.id is not always the WABA for partner events.
    const wabaId = change.value?.waba_info?.waba_id ?? entryId;
    if (!wabaId) return null;
    return this.prisma.whatsappAccount.findFirst({
      where: { wabaId },
      orderBy: { createdAt: 'desc' },
      select,
    });
  }
}
