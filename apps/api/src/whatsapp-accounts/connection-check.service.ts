import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptToken, WhatsAppApiError, type WhatsAppOnboardingClient } from '@speediator/whatsapp';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_ONBOARDING_CLIENT } from './embedded-signup.service';
import { webhookAppIds } from '../webhooks/meta-apps';

type CheckClient = Pick<WhatsAppOnboardingClient, 'getPhoneNumber' | 'listSubscribedApps'>;

export interface ConnectionCheck {
  key: 'token' | 'webhooks' | 'lastWebhook';
  label: string;
  ok: boolean;
  detail: string;
  /** For lastWebhook: when the latest one arrived, so the browser can show local time. */
  at?: string;
}

function metaReason(err: unknown): string {
  if (err instanceof WhatsAppApiError) {
    const meta = (err.body as { error?: { message?: string; code?: number } }).error;
    // 190 = expired or revoked access token.
    if (meta?.code === 190 || err.status === 401) {
      return 'Meta rejected the access token (expired or revoked). Connect the number again.';
    }
    return meta?.message ?? `Meta returned HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Read-only checks against Meta: nothing is changed or sent. */
@Injectable()
export class ConnectionCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(WHATSAPP_ONBOARDING_CLIENT) private readonly meta: CheckClient,
  ) {}

  async check(organizationId: string, id: string) {
    const account = await this.prisma.whatsappAccount.findFirst({ where: { id, organizationId } });
    if (!account) throw new NotFoundException('Account not found');

    const accessToken = decryptToken(
      { encryptedToken: account.encryptedToken, iv: account.iv, authTag: account.authTag },
      this.config.get<string>('WHATSAPP_TOKEN_ENCRYPTION_KEY')!,
    );
    const checks: ConnectionCheck[] = [];

    try {
      const phone = await this.meta.getPhoneNumber(account.phoneNumberId, accessToken);
      checks.push({
        key: 'token',
        label: 'Meta accepts the access token',
        ok: true,
        detail: [phone.verified_name, phone.display_phone_number].filter(Boolean).join(' · ') || `Number ${phone.id}`,
      });
    } catch (err) {
      checks.push({ key: 'token', label: 'Meta accepts the access token', ok: false, detail: metaReason(err) });
    }

    try {
      const apps = await this.meta.listSubscribedApps(account.wabaId, accessToken);
      const ourIds = webhookAppIds(this.config);
      const subscribed = ourIds.length ? apps.some((a) => !!a.id && ourIds.includes(a.id)) : apps.length > 0;
      checks.push({
        key: 'webhooks',
        label: 'Incoming messages are routed to Speediator',
        ok: subscribed,
        detail: subscribed
          ? `Subscribed: ${apps.map((a) => a.name ?? a.id).join(', ')}`
          : 'Your Meta app is not subscribed to this WhatsApp account, so customer messages will not arrive.',
      });
    } catch (err) {
      checks.push({ key: 'webhooks', label: 'Incoming messages are routed to Speediator', ok: false, detail: metaReason(err) });
    }

    const last = await this.prisma.webhookEvent.findFirst({
      where: { organizationId, whatsappAccountId: id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    checks.push({
      key: 'lastWebhook',
      label: 'Speediator has received webhooks for this number',
      ok: !!last,
      detail: last ? 'Received' : 'None yet. Send a WhatsApp message to this number from your phone, then check again.',
      at: last?.createdAt.toISOString(),
    });

    return { ok: checks.every((c) => c.ok), checkedAt: new Date().toISOString(), checks };
  }
}
