import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByPhone(organizationId: string, phone: string, name?: string) {
    return this.prisma.contact.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: { organizationId, phone, name, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date(), ...(name ? { name } : {}) },
    });
  }

  async setOptOut(organizationId: string, phone: string, optOut: boolean) {
    const contact = await this.prisma.contact.findUnique({
      where: { organizationId_phone: { organizationId, phone } },
    });
    if (!contact) return;

    await this.prisma.contact.update({
      where: { id: contact.id },
      data: optOut
        ? { optedOut: true, optedIn: false, optedOutAt: new Date() }
        : { optedOut: false, optedIn: true, optedInAt: new Date() },
    });
  }
}
