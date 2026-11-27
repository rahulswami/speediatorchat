import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import {
  decryptToken,
  encryptToken,
  WhatsAppApiError,
  type PhoneNumberDetails,
  type SmbAppDataSyncType,
  type WhatsAppOnboardingClient,
} from '@speediator/whatsapp';
import { PrismaService } from '../prisma/prisma.service';

export const WHATSAPP_ONBOARDING_CLIENT = Symbol('WHATSAPP_ONBOARDING_CLIENT');

export type OnboardingClient = Pick<
  WhatsAppOnboardingClient,
  | 'exchangeCodeForToken'
  | 'getPhoneNumber'
  | 'listPhoneNumbers'
  | 'subscribeAppToWaba'
  | 'registerPhoneNumber'
  | 'requestSmbAppDataSync'
>;

export interface CompleteSignupInput {
  code: string;
  wabaId: string;
  phoneNumberId?: string;
  businessId?: string;
  /** The popup finished with FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING. */
  coexistence: boolean;
}

/** Never includes the token or PIN: this is what the browser sees. */
export const ACCOUNT_PUBLIC_FIELDS = {
  id: true,
  wabaId: true,
  phoneNumberId: true,
  displayName: true,
  displayPhoneNumber: true,
  verified: true,
  connectionMethod: true,
  status: true,
  isOnBizApp: true,
  webhooksSubscribedAt: true,
  registeredAt: true,
  contactsSyncRequestedAt: true,
  historySyncRequestedAt: true,
  historySyncProgress: true,
  historySyncDeclinedAt: true,
  lastSetupError: true,
  createdAt: true,
} as const;

const SYNC_STEPS: Array<{ type: SmbAppDataSyncType; field: 'contactsSyncRequestedAt' | 'historySyncRequestedAt'; label: string }> = [
  { type: 'smb_app_state_sync', field: 'contactsSyncRequestedAt', label: 'Contact sync' },
  { type: 'history', field: 'historySyncRequestedAt', label: 'Chat history sync' },
];

function describeMetaError(err: unknown): string {
  if (err instanceof WhatsAppApiError) {
    const meta = (err.body as { error?: { message?: string; error_user_msg?: string } }).error;
    return meta?.error_user_msg ?? meta?.message ?? `Meta returned HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class EmbeddedSignupService {
  private readonly logger = new Logger(EmbeddedSignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(WHATSAPP_ONBOARDING_CLIENT) private readonly meta: OnboardingClient,
  ) {}

  private get encKey(): string {
    return this.config.get<string>('WHATSAPP_TOKEN_ENCRYPTION_KEY')!;
  }

  getPublicConfig() {
    const appId = this.config.get<string>('META_APP_ID');
    const configId = this.config.get<string>('META_EMBEDDED_SIGNUP_CONFIG_ID');
    const hasSecret = !!this.config.get<string>('WHATSAPP_APP_SECRET');
    return {
      enabled: !!(appId && configId && hasSecret),
      appId: appId ?? null,
      configId: configId ?? null,
      graphApiVersion: this.config.get<string>('WHATSAPP_API_VERSION'),
    };
  }

  async complete(organizationId: string, input: CompleteSignupInput) {
    const appId = this.config.get<string>('META_APP_ID');
    const appSecret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!appId || !appSecret || !this.config.get<string>('META_EMBEDDED_SIGNUP_CONFIG_ID')) {
      throw new ServiceUnavailableException('Connect with Facebook is not set up on this server');
    }

    let accessToken: string;
    try {
      accessToken = await this.meta.exchangeCodeForToken({ code: input.code, appId, appSecret });
    } catch (err) {
      this.logger.warn(`Embedded Signup code exchange failed: ${describeMetaError(err)}`);
      throw new BadRequestException(
        'Facebook did not accept the sign-up. The link expires after 5 minutes, so please connect again.',
      );
    }

    const phone = await this.resolvePhoneNumber(input.wabaId, input.phoneNumberId, accessToken);

    const elsewhere = await this.prisma.whatsappAccount.findFirst({
      where: { phoneNumberId: phone.id, NOT: { organizationId } },
      select: { id: true },
    });
    if (elsewhere) throw new ConflictException('This number is already connected to another Speediator account');

    const token = encryptToken(accessToken, this.encKey);
    const fields = {
      wabaId: input.wabaId,
      businessId: input.businessId,
      displayName: phone.verified_name ?? phone.display_phone_number ?? phone.id,
      displayPhoneNumber: phone.display_phone_number,
      isOnBizApp: input.coexistence || phone.is_on_biz_app === true,
      encryptedToken: token.encryptedToken,
      iv: token.iv,
      authTag: token.authTag,
      connectionMethod: 'EMBEDDED_SIGNUP' as const,
      status: 'SETUP_INCOMPLETE' as const,
      verified: true,
      lastSetupError: null,
      disconnectedAt: null,
      // A new token means the webhook subscription must be made again.
      webhooksSubscribedAt: null,
    };

    const existing = await this.prisma.whatsappAccount.findFirst({
      where: { organizationId, phoneNumberId: phone.id },
      select: { id: true },
    });
    const account = existing
      ? await this.prisma.whatsappAccount.update({ where: { id: existing.id }, data: fields, select: { id: true } })
      : await this.prisma.whatsappAccount.create({
          data: { ...fields, organizationId, phoneNumberId: phone.id },
          select: { id: true },
        });

    return this.runSetup(organizationId, account.id, accessToken);
  }

  async retrySetup(organizationId: string, id: string) {
    const account = await this.prisma.whatsappAccount.findFirst({ where: { id, organizationId } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.status === 'DISCONNECTED') {
      throw new BadRequestException('This number was disconnected from Meta. Connect it again with Facebook.');
    }
    const accessToken = decryptToken(
      { encryptedToken: account.encryptedToken, iv: account.iv, authTag: account.authTag },
      this.encKey,
    );
    return this.runSetup(organizationId, id, accessToken);
  }

  private async resolvePhoneNumber(
    wabaId: string,
    phoneNumberId: string | undefined,
    accessToken: string,
  ): Promise<PhoneNumberDetails> {
    if (phoneNumberId) {
      try {
        return await this.meta.getPhoneNumber(phoneNumberId, accessToken);
      } catch (err) {
        // Details are cosmetic; the IDs from the popup are enough to finish setup.
        this.logger.warn(`Could not read phone number ${phoneNumberId}: ${describeMetaError(err)}`);
        return { id: phoneNumberId };
      }
    }

    // The coexistence finish event carries only the WABA ID.
    let numbers: PhoneNumberDetails[];
    try {
      numbers = await this.meta.listPhoneNumbers(wabaId, accessToken);
    } catch (err) {
      throw new BadRequestException(`Could not read the numbers on this WhatsApp account: ${describeMetaError(err)}`);
    }
    const pick = numbers.length === 1 ? numbers[0] : numbers.find((n) => n.is_on_biz_app);
    if (!pick) {
      throw new BadRequestException(
        numbers.length === 0
          ? 'This WhatsApp account has no phone number yet'
          : 'This WhatsApp account has several numbers. Connect again and pick one number in the Facebook window.',
      );
    }
    return pick;
  }

  /** Each step records its own timestamp, so a retry resumes where the last attempt stopped. */
  private async runSetup(organizationId: string, id: string, accessToken: string) {
    let account = await this.prisma.whatsappAccount.findFirstOrThrow({ where: { id, organizationId } });
    const save = (data: Parameters<typeof this.prisma.whatsappAccount.update>[0]['data']) =>
      this.prisma.whatsappAccount.update({ where: { id }, data });

    try {
      if (!account.webhooksSubscribedAt) {
        await this.meta.subscribeAppToWaba(account.wabaId, accessToken);
        account = await save({ webhooksSubscribedAt: new Date() });
      }

      // Coexistence numbers are already registered by the WhatsApp Business app.
      if (!account.isOnBizApp && !account.registeredAt) {
        const pin = account.encryptedPin
          ? decryptToken(
              { encryptedToken: account.encryptedPin, iv: account.pinIv!, authTag: account.pinAuthTag! },
              this.encKey,
            )
          : String(randomInt(0, 1_000_000)).padStart(6, '0');
        if (!account.encryptedPin) {
          const enc = encryptToken(pin, this.encKey);
          account = await save({ encryptedPin: enc.encryptedToken, pinIv: enc.iv, pinAuthTag: enc.authTag });
        }
        await this.meta.registerPhoneNumber(account.phoneNumberId, accessToken, pin);
        account = await save({ registeredAt: new Date() });
      }
    } catch (err) {
      const message = describeMetaError(err);
      this.logger.warn(`WhatsApp setup for account ${id} stopped: ${message}`);
      await save({ status: 'SETUP_INCOMPLETE', lastSetupError: message });
      return this.publicAccount(organizationId, id);
    }

    // Sync requests are allowed once, within 24 hours of onboarding. A failure here should
    // not block messaging, so the account still counts as connected.
    const syncProblems: string[] = [];
    if (account.isOnBizApp) {
      for (const step of SYNC_STEPS) {
        if (account[step.field]) continue;
        try {
          await this.meta.requestSmbAppDataSync(account.phoneNumberId, accessToken, step.type);
          account = await save({ [step.field]: new Date() });
        } catch (err) {
          syncProblems.push(`${step.label} could not be requested: ${describeMetaError(err)}`);
        }
      }
    }

    await save({ status: 'CONNECTED', lastSetupError: syncProblems.join(' ') || null });
    return this.publicAccount(organizationId, id);
  }

  private publicAccount(organizationId: string, id: string) {
    return this.prisma.whatsappAccount.findFirstOrThrow({
      where: { id, organizationId },
      select: ACCOUNT_PUBLIC_FIELDS,
    });
  }
}
