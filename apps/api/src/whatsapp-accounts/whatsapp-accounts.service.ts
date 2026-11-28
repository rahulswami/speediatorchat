import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { encryptToken, decryptToken, whatsAppClient } from '@speediator/whatsapp';
import { rethrowMetaError } from '../common/meta-error';
import type { UploadedFile } from '../common/uploaded-file';
import { ACCOUNT_PUBLIC_FIELDS } from './embedded-signup.service';

export interface ConnectAccountDto {
  wabaId: string;
  phoneNumberId: string;
  displayName: string;
  accessToken: string;
}

@Injectable()
export class WhatsappAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get encKey(): string {
    return this.config.get<string>('WHATSAPP_TOKEN_ENCRYPTION_KEY')!;
  }

  async connect(organizationId: string, dto: ConnectAccountDto) {
    const existing = await this.prisma.whatsappAccount.findFirst({
      where: { organizationId, phoneNumberId: dto.phoneNumberId },
    });
    if (existing) throw new ConflictException('Phone number already connected');

    const { encryptedToken, iv, authTag } = encryptToken(dto.accessToken, this.encKey);

    return this.prisma.whatsappAccount.create({
      data: {
        organizationId,
        wabaId: dto.wabaId,
        phoneNumberId: dto.phoneNumberId,
        displayName: dto.displayName,
        encryptedToken,
        iv,
        authTag,
        verified: true,
      },
      select: {
        id: true,
        wabaId: true,
        phoneNumberId: true,
        displayName: true,
        verified: true,
        verifyToken: true,
        createdAt: true,
      },
    });
  }

  async list(organizationId: string) {
    return this.prisma.whatsappAccount.findMany({
      where: { organizationId },
      select: ACCOUNT_PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async disconnect(organizationId: string, id: string) {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id, organizationId },
    });
    if (!account) throw new NotFoundException('Account not found');

    await this.prisma.whatsappAccount.delete({ where: { id } });
  }

  async getDecryptedToken(organizationId: string, id: string): Promise<string> {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id, organizationId },
    });
    if (!account) throw new NotFoundException('Account not found');

    return decryptToken(
      { encryptedToken: account.encryptedToken, iv: account.iv, authTag: account.authTag },
      this.encKey,
    );
  }

  /** Uploads a file to send as a template's media header. The returned id works for 30 days. */
  async uploadMedia(organizationId: string, id: string, file: UploadedFile) {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { id, organizationId },
      select: { id: true, phoneNumberId: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    const accessToken = await this.getDecryptedToken(organizationId, account.id);
    const mediaId = await whatsAppClient
      .uploadMedia({ phoneNumberId: account.phoneNumberId, accessToken, fileName: file.fileName, fileType: file.fileType, bytes: file.bytes })
      .catch(rethrowMetaError('Meta did not accept the file'));
    return { id: mediaId, format: file.format, fileName: file.fileName };
  }

  async findByVerifyToken(verifyToken: string) {
    return this.prisma.whatsappAccount.findUnique({ where: { verifyToken } });
  }

  async markVerified(id: string) {
    return this.prisma.whatsappAccount.update({ where: { id }, data: { verified: true } });
  }
}
