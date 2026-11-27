import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CoexistenceService } from '../coexistence/coexistence.service';
import {
  extractContent,
  isFromBusiness,
  toDate,
  type EchoValue,
  type HistoryValue,
  type StateSyncValue,
  type WaMessage,
} from '../coexistence/coexistence-payloads';

const WEBHOOK_QUEUE = 'webhook-events';
// Meta's docs don't say which of these fires when a customer removes our access, so both count.
const DISCONNECT_EVENTS = new Set(['PARTNER_APP_UNINSTALLED', 'PARTNER_REMOVED', 'ACCOUNT_DELETED', 'ACCOUNT_OFFBOARDED']);

interface AccountUpdateValue {
  event?: string;
  waba_info?: { waba_id?: string; owner_business_id?: string };
}

const OPT_OUT_KEYWORDS = /^(stop|unsubscribe|opt\s*out)$/i;
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_ORDER = ['PENDING', 'SENT', 'DELIVERED', 'READ'] as const;
const STATUS_MAP: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

@Processor(WEBHOOK_QUEUE)
export class WebhookEventsConsumer extends WorkerHost {
  private readonly logger = new Logger(WebhookEventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly events: EventEmitter2,
    private readonly coexistence: CoexistenceService,
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
          field?: string;
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
              errors?: Array<{ title?: string; message?: string }>;
            }>;
            contacts?: Array<{ profile?: { name?: string } }>;
            metadata?: { display_phone_number?: string; phone_number_id?: string };
          };
        }>;
      }>;
    };

    const change = payload.entry?.[0]?.changes?.[0];
    const value = change?.value;
    if (!value) return;

    if (change.field === 'account_update') {
      await this.processAccountUpdate(event.organizationId, change.value as AccountUpdateValue);
      return;
    }

    const account = event.whatsappAccountId
      ? await this.prisma.whatsappAccount.findFirst({
          where: { id: event.whatsappAccountId, organizationId: event.organizationId },
        })
      : null;
    if (!account) return;

    switch (change.field) {
      case 'smb_app_state_sync':
        return this.coexistence.syncContacts(event.organizationId, value as StateSyncValue);
      case 'smb_message_echoes':
        return this.coexistence.mirrorEchoes(event.organizationId, account.id, value as EchoValue);
      case 'history':
        return this.coexistence.importHistory(event.organizationId, account.id, value as HistoryValue);
    }

    // Process inbound messages
    if (value.messages?.length) {
      for (const msg of value.messages) {
        await this.processInboundMessage(
          event.organizationId,
          account.id,
          msg,
          value.contacts?.[0],
          value.metadata?.display_phone_number,
        );
      }
    }

    // Process status updates
    if (value.statuses?.length) {
      for (const status of value.statuses) {
        await this.processStatusUpdate(event.organizationId, status);
      }
    }
  }

  private async processAccountUpdate(organizationId: string, value: AccountUpdateValue) {
    const wabaId = value.waba_info?.waba_id;
    if (!wabaId || !DISCONNECT_EVENTS.has(value.event ?? '')) {
      this.logger.debug(`account_update ${value.event} for WABA ${wabaId}: no action`);
      return;
    }

    const { count } = await this.prisma.whatsappAccount.updateMany({
      where: { organizationId, wabaId, status: { not: 'DISCONNECTED' } },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        lastSetupError: `Access was removed in Meta (${value.event}). Connect the number again to keep messaging.`,
      },
    });
    this.logger.warn(`WABA ${wabaId} sent ${value.event}; marked ${count} account(s) disconnected`);
  }

  private async processInboundMessage(
    organizationId: string,
    whatsappAccountId: string,
    msg: WaMessage & { from: string; timestamp: string },
    contactInfo?: { profile?: { name?: string } },
    businessPhone?: string,
  ) {
    const existing = await this.prisma.message.findUnique({ where: { metaMessageId: msg.id } });
    if (existing) {
      // Coexistence history sends media as a placeholder, then the file on this webhook.
      if (existing.type === 'media_placeholder' && existing.organizationId === organizationId) {
        await this.prisma.message.update({
          where: { id: existing.id },
          data: { type: msg.type, content: extractContent(msg) },
        });
        this.logger.debug(`Filled in history media for ${msg.id}`);
      } else {
        this.logger.warn(`Message ${msg.id} already processed, skipping`);
      }
      return;
    }

    // History media the business itself sent can arrive here too. It isn't a customer
    // message, so it must not create a contact for the business's own number.
    if (isFromBusiness(msg, businessPhone)) {
      this.logger.warn(`Skipping ${msg.id}: sent by the business number, not a customer`);
      return;
    }

    const phone = msg.from;
    const name = contactInfo?.profile?.name;
    const contact = await this.contacts.upsertByPhone(organizationId, phone, name);

    if (msg.type === 'text' && msg.text?.body && OPT_OUT_KEYWORDS.test(msg.text.body.trim())) {
      await this.contacts.setOptOut(organizationId, phone, true);
      this.logger.log(`Contact ${phone} opted out`);
    }

    // The 24h window runs from when the customer sent the message, not from when we got it:
    // an old message delivered late (e.g. history media) must not reopen the window.
    const sentAt = toDate(msg.timestamp);
    const conversation = await this.conversations.upsert({
      organizationId,
      contactId: contact.id,
      whatsappAccountId,
      sessionExpiresAt: new Date(sentAt.getTime() + SESSION_WINDOW_MS),
      messageAt: sentAt,
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        organizationId,
        direction: 'INBOUND',
        type: msg.type,
        content: extractContent(msg),
        metaMessageId: msg.id,
        status: 'DELIVERED',
        createdAt: sentAt,
      },
    });

    this.events.emit('inbox.message', { organizationId, conversation, message, contact });
    this.logger.debug(`Processed inbound message ${msg.id} from ${phone}`);
  }

  private async processStatusUpdate(
    organizationId: string,
    status: { id: string; status: string; timestamp: string; errors?: Array<{ title?: string; message?: string }> },
  ) {
    const mapped = STATUS_MAP[status.status];
    if (!mapped) return;
    const at = toDate(status.timestamp);
    // Meta can deliver statuses out of order, so only ever move forward (read beats delivered).
    const earlier = mapped === 'FAILED' ? [] : STATUS_ORDER.slice(0, STATUS_ORDER.indexOf(mapped));
    const error = status.errors?.[0]?.message ?? status.errors?.[0]?.title;

    await this.prisma.message.updateMany({
      where: { organizationId, metaMessageId: status.id, ...(mapped === 'FAILED' ? {} : { status: { in: earlier } }) },
      data: {
        status: mapped,
        ...(mapped === 'DELIVERED' ? { deliveredAt: at } : {}),
        ...(mapped === 'READ' ? { readAt: at } : {}),
      },
    });

    await this.prisma.campaignContact.updateMany({
      where: {
        metaMessageId: status.id,
        campaign: { organizationId },
        ...(mapped === 'FAILED' ? {} : { status: { in: earlier } }),
      },
      data: {
        status: mapped,
        ...(mapped === 'DELIVERED' ? { deliveredAt: at } : {}),
        // A read receipt implies delivery even if the delivered status never arrived.
        ...(mapped === 'READ' ? { readAt: at } : {}),
        ...(mapped === 'FAILED' ? { error: error ?? 'Meta reported the message as failed' } : {}),
      },
    });
  }
}
