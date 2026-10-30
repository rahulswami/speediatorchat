import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const WEBHOOK_QUEUE = 'webhook-events';
const OPT_OUT_KEYWORDS = /^(stop|unsubscribe|opt\s*out)$/i;

@Processor(WEBHOOK_QUEUE)
export class WebhookEventsConsumer extends WorkerHost {
  private readonly logger = new Logger(WebhookEventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<{ eventId: string }>): Promise<void> {
    const { eventId } = job.data;

    const event = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      this.logger.warn(`Event ${eventId} not found`);
      return;
    }

    if (event.status === 'PROCESSED') {
      this.logger.debug(`Event ${eventId} already processed, skipping`);
      return;
    }

    await this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSING' },
    });

    try {
      await this.processPayload(event);
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (err) {
      const retryCount = event.retryCount + 1;
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'FAILED', retryCount },
      });
      this.logger.error(`Event ${eventId} failed (attempt ${retryCount})`, String(err));
      throw err;
    }
  }

  private async processPayload(event: { id: string; organizationId: string; whatsappAccountId: string | null; payload: unknown }) {
    const payload = event.payload as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              id: string;
              from: string;
              type: string;
              text?: { body: string };
              timestamp: string;
              [key: string]: unknown;
            }>;
            statuses?: Array<{
              id: string;
              status: string;
              timestamp: string;
            }>;
            contacts?: Array<{ profile?: { name?: string } }>;
          };
        }>;
      }>;
    };

    const value = payload.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;

    const account = event.whatsappAccountId
      ? await this.prisma.whatsappAccount.findUnique({ where: { id: event.whatsappAccountId } })
      : null;

    // Process inbound messages
    if (value.messages?.length && account) {
      for (const msg of value.messages) {
        await this.processInboundMessage(event.organizationId, account.id, msg, value.contacts?.[0]);
      }
    }

    // Process status updates
    if (value.statuses?.length) {
      for (const status of value.statuses) {
        await this.processStatusUpdate(status);
      }
    }
  }

  private async processInboundMessage(
    organizationId: string,
    whatsappAccountId: string,
    msg: { id: string; from: string; type: string; text?: { body: string }; timestamp: string; [key: string]: unknown },
    contactInfo?: { profile?: { name?: string } },
  ) {
    // Idempotency: skip if already processed
    const existing = await this.prisma.message.findUnique({ where: { metaMessageId: msg.id } });
    if (existing) {
      this.logger.debug(`Message ${msg.id} already processed, skipping`);
      return;
    }

    const phone = msg.from;
    const name = contactInfo?.profile?.name;

    // Upsert contact
    const contact = await this.contacts.upsertByPhone(organizationId, phone, name);

    // Check for opt-out
    if (msg.type === 'text' && msg.text?.body && OPT_OUT_KEYWORDS.test(msg.text.body.trim())) {
      await this.contacts.setOptOut(organizationId, phone, true);
      this.logger.log(`Contact ${phone} opted out`);
    }

    // Session window: 24 hours from inbound message
    const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Upsert conversation
    const conversation = await this.conversations.upsert({
      organizationId,
      contactId: contact.id,
      whatsappAccountId,
      sessionExpiresAt,
    });

    // Build content object based on message type
    const content = this.extractContent(msg);

    // Create message
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        organizationId,
        direction: 'INBOUND',
        type: msg.type,
        content,
        metaMessageId: msg.id,
        status: 'DELIVERED',
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Emit real-time event
    this.events.emit('inbox.message', { organizationId, conversation, message, contact });
    this.logger.debug(`Processed inbound message ${msg.id} from ${phone}`);
  }

  private extractContent(msg: { type: string; text?: { body: string }; [key: string]: unknown }): object {
    switch (msg.type) {
      case 'text':
        return { body: msg.text?.body ?? '' };
      case 'image':
      case 'audio':
      case 'video':
      case 'document':
      case 'sticker':
        return (msg[msg.type] as object) ?? {};
      case 'location':
        return (msg.location as object) ?? {};
      default:
        return { raw: msg };
    }
  }

  private async processStatusUpdate(status: { id: string; status: string; timestamp: string }) {
    const statusMap: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
    };

    const mapped = statusMap[status.status];
    if (!mapped) return;

    const ts = new Date(parseInt(status.timestamp, 10) * 1000);
    await this.prisma.message.updateMany({
      where: { metaMessageId: status.id },
      data: {
        status: mapped,
        ...(mapped === 'DELIVERED' ? { deliveredAt: ts } : {}),
        ...(mapped === 'READ' ? { readAt: ts } : {}),
      },
    });
  }
}
