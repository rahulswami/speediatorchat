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
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

@Controller('webhooks')
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly service: WebhooksService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
    if (!verifyToken) {
      return reply.status(403).send({ message: 'Verification failed' });
    }

    // Embedded Signup: one callback and one app-level token for every customer.
    const appToken = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    if (appToken && safeEqual(verifyToken, appToken)) {
      return reply.status(200).send(parseInt(challenge, 10));
    }

    // Manually connected channels each carry their own token.
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
