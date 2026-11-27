import { Injectable } from '@nestjs/common';
import type { ConversationStatus } from '@speediator/prisma';
import { PrismaService } from '../prisma/prisma.service';

interface ConversationKey {
  organizationId: string;
  contactId: string;
  whatsappAccountId: string;
}

const later = (a: Date | null, b: Date) => (a && a > b ? a : b);

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The customer's ongoing conversation on this number: an open one if any, otherwise the
   * most recent one (so imported Business-app history and new messages share a thread).
   */
  private findCurrent(key: ConversationKey) {
    return this.prisma.conversation.findFirst({
      where: key,
      orderBy: [{ status: 'asc' }, { lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }

  /** A customer wrote in: reopen or start the conversation and extend the 24h window. */
  async upsert(data: ConversationKey & { sessionExpiresAt: Date; messageAt: Date }) {
    const { sessionExpiresAt, messageAt, ...key } = data;
    const current = await this.findCurrent(key);

    if (current) {
      return this.prisma.conversation.update({
        where: { id: current.id },
        data: {
          status: current.status === 'PENDING' ? 'PENDING' : 'OPEN',
          sessionExpiresAt: later(current.sessionExpiresAt, sessionExpiresAt),
          lastMessageAt: later(current.lastMessageAt, messageAt),
        },
      });
    }

    return this.prisma.conversation.create({
      data: { ...key, sessionExpiresAt, lastMessageAt: messageAt },
    });
  }

  /** For mirrored messages: never opens the 24h window, since only customer messages do. */
  async findOrCreate(key: ConversationKey, statusIfNew: ConversationStatus) {
    return (await this.findCurrent(key)) ?? this.prisma.conversation.create({ data: { ...key, status: statusIfNew } });
  }

  async touch(id: string, current: Date | null, messageAt: Date, sessionExpiresAt?: Date | null) {
    return this.prisma.conversation.update({
      where: { id },
      data: {
        lastMessageAt: later(current, messageAt),
        ...(sessionExpiresAt ? { sessionExpiresAt, status: 'OPEN' as const } : {}),
      },
    });
  }
}
