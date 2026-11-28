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
import { webhookApps } from '../meta-apps';

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

    const secrets = webhookApps(this.config).map((a) => a.secret);
    if (!secrets.length) {
      // Without the secret anyone could post fake messages, so production refuses them.
      // Local development may run without one to replay sample payloads.
      if (this.config.get<string>('NODE_ENV') === 'production') {
        this.logger.error('WHATSAPP_APP_SECRET is not set; rejecting webhook');
        throw new ForbiddenException('Webhook signature cannot be verified');
      }
      this.logger.warn('WHATSAPP_APP_SECRET is not set; skipping signature check outside production');
      return true;
    }

    // rawBody is attached to the underlying IncomingMessage by the content-type parser
    const rawBody: Buffer =
      (request.raw as unknown as { rawBody: Buffer }).rawBody ??
      (request as unknown as { rawBody: Buffer }).rawBody;
    if (!rawBody) {
      throw new ForbiddenException('Raw body unavailable for signature verification');
    }

    // Each Meta app signs with its own secret; the request is genuine if any of ours matches.
    const sigBuf = Buffer.from(signature);
    const valid = secrets.some((secret) => {
      const expBuf = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
      return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
    });
    if (!valid) {
      this.logger.warn('Webhook signature matches none of the configured Meta app secrets');
      throw new ForbiddenException('Invalid webhook signature');
    }

    return true;
  }
}
