import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappAccountsService } from '../whatsapp-accounts/whatsapp-accounts.service';
import { whatsAppClient } from '@speediator/whatsapp';
import { MessageDirection, MessageStatus } from '@speediator/prisma';

const OPT_OUT_KEYWORDS = /^(stop|unsubscribe|opt\s*out)$/i;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly waAccountsService: WhatsappAccountsService,
  ) {}

  async list(organizationId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendText(
    organizationId: string,
    conversationId: string,
    body: string,
    userId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: {
        contact: true,
        whatsappAccount: true,
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.whatsappAccount.status !== 'CONNECTED') {
      throw new BadRequestException(
        conversation.whatsappAccount.status === 'DISCONNECTED'
          ? 'This WhatsApp number was disconnected. Connect it again from the Connect page.'
          : 'This WhatsApp number has not finished setup. Finish it on the Connect page.',
      );
    }

    // Enforce 24-hour session window
    if (!conversation.sessionExpiresAt || conversation.sessionExpiresAt < new Date()) {
      throw new BadRequestException(
        'Session window closed. Only template messages can be sent.',
      );
    }

    if (conversation.contact.optedOut) {
      throw new BadRequestException('Contact has opted out');
    }

    const accessToken = await this.waAccountsService.getDecryptedToken(
      organizationId,
      conversation.whatsappAccountId,
    );

    const result = await whatsAppClient.sendText({
      phoneNumberId: conversation.whatsappAccount.phoneNumberId,
      accessToken,
      to: conversation.contact.phone,
      body,
    });

    const metaMessageId = result.messages?.[0]?.id;

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        organizationId,
        direction: MessageDirection.OUTBOUND,
        type: 'text',
        content: { body },
        metaMessageId,
        status: MessageStatus.SENT,
        sentAt: new Date(),
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return message;
  }

  async updateStatus(metaMessageId: string, status: MessageStatus, timestamps: {
    deliveredAt?: Date;
    readAt?: Date;
  }) {
    await this.prisma.message.updateMany({
      where: { metaMessageId },
      data: { status, ...timestamps },
    });
  }

  async createInbound(data: {
    organizationId: string;
    conversationId: string;
    metaMessageId: string;
    type: string;
    content: object;
  }) {
    return this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        organizationId: data.organizationId,
        direction: MessageDirection.INBOUND,
        type: data.type,
        content: data.content,
        metaMessageId: data.metaMessageId,
        status: MessageStatus.DELIVERED,
      },
    });
  }

  isOptOutMessage(text: string): boolean {
    return OPT_OUT_KEYWORDS.test(text.trim());
  }
}
