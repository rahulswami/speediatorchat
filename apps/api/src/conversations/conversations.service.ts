import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { ConversationStatus } from '@speediator/prisma';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(
    organizationId: string,
    opts: { status?: ConversationStatus; assignedTo?: string; page?: number; limit?: number },
  ) {
    const { status, assignedTo, page = 1, limit = 30 } = opts;
    const where = {
      organizationId,
      ...(status ? { status } : {}),
      ...(assignedTo ? { assignedTo } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { lastMessageAt: 'desc' },
        include: {
          contact: { select: { id: true, phone: true, name: true, avatarUrl: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, type: true, content: true, direction: true, createdAt: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(organizationId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, organizationId },
      include: {
        contact: true,
        whatsappAccount: { select: { id: true, displayName: true, phoneNumberId: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async updateStatus(organizationId: string, id: string, status: ConversationStatus) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return this.prisma.conversation.update({ where: { id }, data: { status } });
  }

  async assign(organizationId: string, id: string, assignedTo: string | null) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return this.prisma.conversation.update({ where: { id }, data: { assignedTo } });
  }

  async suggestReply(organizationId: string, conversationId: string): Promise<{ suggestion: string }> {
    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) return { suggestion: '' };

    const messages = await this.prisma.message.findMany({
      where: { conversation: { id: conversationId, organizationId } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { direction: true, content: true },
    });

    if (messages.length === 0) return { suggestion: '' };

    const conversation = messages
      .map((m) => {
        const body = (m.content as { body?: string })?.body ?? '[media]';
        return `${m.direction === 'INBOUND' ? 'Customer' : 'Agent'}: ${body}`;
      })
      .join('\n');

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:
        'You are a helpful customer support agent. Given the conversation, suggest a short, friendly reply for the agent to send next. Reply with only the suggested message text, no preamble.',
      messages: [{ role: 'user', content: conversation }],
    });

    const block = response.content[0];
    const suggestion = block.type === 'text' ? block.text.trim() : '';
    return { suggestion };
  }

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
