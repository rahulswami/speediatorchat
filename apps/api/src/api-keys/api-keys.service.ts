import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, userId: string, data: {
    name: string;
    scopes: string[];
    expiresAt?: string;
  }) {
    const rawKey = `sk_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    await this.prisma.apiKey.create({
      data: {
        organizationId,
        createdBy: userId,
        name: data.name,
        keyHash,
        scopes: data.scopes,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
    return { key: rawKey, name: data.name, scopes: data.scopes };
  }

  async list(organizationId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId },
      select: { id: true, name: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(organizationId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, organizationId } });
    if (!key) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.delete({ where: { id } });
  }

  async validateKey(rawKey: string) {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const apiKey = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    if (!apiKey) throw new UnauthorizedException('Invalid API key');
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) throw new UnauthorizedException('API key expired');
    await this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
    return apiKey;
  }
}
