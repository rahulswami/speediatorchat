import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import {
  contactChanges,
  parseEchoes,
  parseHistory,
  type EchoValue,
  type HistoryValue,
  type StateSyncValue,
} from './coexistence-payloads';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Mirrors a coexistence number's WhatsApp Business app into Speediator: address-book
 * contacts, messages the business sends from the app, and the imported chat history.
 * None of this grants marketing consent: mirrored contacts keep optedIn = false.
 */
@Injectable()
export class CoexistenceService {
  private readonly logger = new Logger(CoexistenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly events: EventEmitter2,
  ) {}

  private upsertContact(organizationId: string, phone: string, name?: string) {
    return this.prisma.contact.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: { organizationId, phone, name },
      update: name ? { name } : {},
    });
  }

  async syncContacts(organizationId: string, value: StateSyncValue) {
    const changes = contactChanges(value);
    let added = 0;
    for (const change of changes) {
      // Removing someone from the phone's address book shouldn't delete their conversations.
      if (change.action === 'remove') continue;
      await this.upsertContact(organizationId, change.phone, change.name);
      added++;
    }
    this.logger.log(`Contact sync: ${added} added or updated, ${changes.length - added} removals ignored`);
  }

  async mirrorEchoes(organizationId: string, whatsappAccountId: string, value: EchoValue) {
    for (const action of parseEchoes(value)) {
      if (action.kind === 'edit') {
        await this.prisma.message.updateMany({
          where: { organizationId, metaMessageId: action.originalId },
          data: { type: action.type, content: action.content },
        });
        continue;
      }
      if (action.kind === 'revoke') {
        await this.prisma.message.updateMany({
          where: { organizationId, metaMessageId: action.originalId },
          data: { type: 'revoked', content: { revoked: true } },
        });
        continue;
      }

      const { message: echo } = action;
      const existing = await this.prisma.message.findUnique({ where: { metaMessageId: echo.metaMessageId } });
      if (existing) {
        this.logger.warn(`Echo ${echo.metaMessageId} already stored, skipping`);
        continue;
      }

      const contact = await this.upsertContact(organizationId, action.phone);
      const conversation = await this.conversations.findOrCreate(
        { organizationId, contactId: contact.id, whatsappAccountId },
        'OPEN',
      );
      const message = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          organizationId,
          direction: 'OUTBOUND',
          source: 'BUSINESS_APP',
          type: echo.type,
          content: echo.content,
          metaMessageId: echo.metaMessageId,
          status: 'SENT',
          sentAt: echo.at,
          createdAt: echo.at,
        },
      });
      const updated = await this.conversations.touch(conversation.id, conversation.lastMessageAt, echo.at);
      this.events.emit('inbox.message', { organizationId, conversation: updated, message, contact });
    }
  }

  async importHistory(organizationId: string, whatsappAccountId: string, value: HistoryValue) {
    const batch = parseHistory(value);

    if (batch.declined) {
      await this.prisma.whatsappAccount.updateMany({
        where: { id: whatsappAccountId, organizationId },
        data: { historySyncDeclinedAt: new Date() },
      });
      this.logger.warn(`Account ${whatsappAccountId}: the business turned off history sharing`);
      return;
    }

    let imported = 0;
    for (const thread of batch.threads) {
      if (thread.messages.length === 0) continue;
      const contact = await this.upsertContact(organizationId, thread.phone);
      const conversation = await this.conversations.findOrCreate(
        { organizationId, contactId: contact.id, whatsappAccountId },
        'RESOLVED',
      );

      const { count } = await this.prisma.message.createMany({
        data: thread.messages.map((m) => ({
          conversationId: conversation.id,
          organizationId,
          direction: m.direction,
          source: 'HISTORY' as const,
          type: m.type,
          content: m.content,
          metaMessageId: m.metaMessageId,
          status: m.status,
          sentAt: m.direction === 'OUTBOUND' ? m.at : null,
          createdAt: m.at,
        })),
        // Messages that also arrived live (or in an earlier chunk) are kept as they are.
        skipDuplicates: true,
      });
      imported += count;

      const lastAt = thread.messages[thread.messages.length - 1].at;
      // A customer message from the last 24 hours still opens the reply window.
      const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'INBOUND');
      const window = lastInbound ? new Date(lastInbound.at.getTime() + SESSION_WINDOW_MS) : null;
      const opensWindow =
        window && window > new Date() && (!conversation.sessionExpiresAt || window > conversation.sessionExpiresAt);
      await this.conversations.touch(conversation.id, conversation.lastMessageAt, lastAt, opensWindow ? window : null);
    }

    if (batch.progress !== undefined) {
      // Chunks can arrive out of order, so only ever move progress forward.
      await this.prisma.whatsappAccount.updateMany({
        where: {
          id: whatsappAccountId,
          organizationId,
          OR: [{ historySyncProgress: null }, { historySyncProgress: { lt: batch.progress } }],
        },
        data: { historySyncProgress: batch.progress },
      });
    }
    this.logger.log(`History import: ${imported} messages across ${batch.threads.length} chats (progress ${batch.progress ?? '?'}%)`);
  }
}
