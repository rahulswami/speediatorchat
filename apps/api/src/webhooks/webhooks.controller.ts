import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  HttpCode,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks')
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly service: WebhooksService,
    private readonly prisma: PrismaService,
  ) {}

  // Meta webhook verification handshake
  @Get('whatsapp')
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() reply: FastifyReply,
  ) {
    if (mode !== 'subscribe') {
      return reply.status(400).send({ message: 'Invalid mode' });
    }

    const account = await this.prisma.whatsappAccount.findUnique({ where: { verifyToken } });
    if (!account) {
      return reply.status(403).send({ message: 'Verification failed' });
    }

    await this.prisma.whatsappAccount.update({
      where: { id: account.id },
      data: { verified: true },
    });

    return reply.status(200).send(parseInt(challenge, 10));
  }

  @Post('whatsapp')
  @HttpCode(200)
  @UseGuards(WebhookSignatureGuard)
  async receive(@Body() body: object) {
    // Fire-and-forget; errors logged inside service
    this.service.handleIncoming(body).catch((err) =>
      this.logger.error('Webhook store failed', err),
    );
    return { status: 'ok' };
  }
}
