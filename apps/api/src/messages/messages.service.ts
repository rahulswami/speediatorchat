import { Injectable, NotFoundException, BadRequestException, BadGatewayException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappAccountsService } from '../whatsapp-accounts/whatsapp-accounts.service';
import { whatsAppClient, WhatsAppApiError } from '@speediator/whatsapp';
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

    const result = await whatsAppClient
      .sendText({
        phoneNumberId: conversation.whatsappAccount.phoneNumberId,
        accessToken,
        to: conversation.contact.phone,
        body,
      })
      .catch(rethrowMetaError);

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

  /**
   * The only kind of message allowed once the 24-hour window has closed. Marketing
   * templates additionally need the contact's opt-in.
   */
  async sendTemplate(organizationId: string, conversationId: string, templateId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { contact: true, whatsappAccount: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.whatsappAccount.status !== 'CONNECTED') {
      throw new BadRequestException('This WhatsApp number is not connected. Check it on the Connect page.');
    }

    const template = await this.prisma.template.findFirst({ where: { id: templateId, organizationId } });
    if (!template) throw new NotFoundException('Template not found');
    if (template.status !== 'APPROVED') throw new BadRequestException('Only approved templates can be sent');
    if (template.whatsappAccountId !== conversation.whatsappAccountId) {
      throw new BadRequestException('This template belongs to a different WhatsApp number');
    }
    if (conversation.contact.optedOut) throw new BadRequestException('Contact has opted out');
    if (template.category === 'MARKETING' && !conversation.contact.optedIn) {
      throw new BadRequestException('Marketing templates can only be sent to contacts who opted in');
    }

    const accessToken = await this.waAccountsService.getDecryptedToken(
      organizationId,
      conversation.whatsappAccountId,
    );
    const result = await whatsAppClient
      .sendTemplate({
        phoneNumberId: conversation.whatsappAccount.phoneNumberId,
        accessToken,
        to: conversation.contact.phone,
        templateName: template.name,
        languageCode: template.language,
        components: [],
      })
      .catch(rethrowMetaError);

    const sentAt = new Date();
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        organizationId,
        direction: MessageDirection.OUTBOUND,
        type: 'template',
        content: { templateName: template.name, language: template.language },
        metaMessageId: result.messages?.[0]?.id,
        status: MessageStatus.SENT,
        sentAt,
      },
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: sentAt } });
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

/** Shows Meta's reason (e.g. "Re-engagement message") instead of a bare server error. */
function rethrowMetaError(err: unknown): never {
  if (err instanceof WhatsAppApiError) {
    const meta = (err.body as { error?: { message?: string; error_user_msg?: string } }).error;
    const reason = meta?.error_user_msg ?? meta?.message ?? `HTTP ${err.status}`;
    throw err.status >= 500 ? new BadGatewayException(`WhatsApp is unavailable: ${reason}`) : new BadRequestException(`WhatsApp rejected the message: ${reason}`);
  }
  throw err;
}
