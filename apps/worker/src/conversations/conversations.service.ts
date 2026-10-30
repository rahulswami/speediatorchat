import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: {
    organizationId: string;
    contactId: string;
    whatsappAccountId: string;
    sessionExpiresAt: Date;
  }) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        organizationId: data.organizationId,
        contactId: data.contactId,
        whatsappAccountId: data.whatsappAccountId,
        status: { in: ['OPEN', 'PENDING'] },
      },
    });

    if (existing) {
      return this.prisma.conversation.update({
        where: { id: existing.id },
        data: { sessionExpiresAt: data.sessionExpiresAt, lastMessageAt: new Date() },
      });
    }

    return this.prisma.conversation.create({
      data: { ...data, lastMessageAt: new Date() },
    });
  }
}
