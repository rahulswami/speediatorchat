import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const signature = (request.headers as Record<string, string>)['x-hub-signature-256'];

    if (!signature) {
      this.logger.warn('Missing X-Hub-Signature-256 header');
      throw new ForbiddenException('Missing webhook signature');
    }

    const appSecret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      // In dev/test with no secret configured, skip verification
      return true;
    }

    // rawBody is attached to the underlying IncomingMessage by the content-type parser
    const rawBody: Buffer =
      (request.raw as unknown as { rawBody: Buffer }).rawBody ??
      (request as unknown as { rawBody: Buffer }).rawBody;
    if (!rawBody) {
      throw new ForbiddenException('Raw body unavailable for signature verification');
    }

    const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

    try {
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new ForbiddenException('Invalid webhook signature');
      }
    } catch {
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }
}
