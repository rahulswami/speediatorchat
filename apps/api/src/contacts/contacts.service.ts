import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    opts: { search?: string; optedIn?: boolean; page?: number; limit?: number },
  ) {
    const { search, optedIn, page = 1, limit = 50 } = opts;
    const where = {
      organizationId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
            ],
          }
        : {}),
      ...(optedIn !== undefined ? { optedIn } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          tagMap: { include: { tag: true } },
          attributes: true,
        },
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async get(organizationId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId },
      include: {
        tagMap: { include: { tag: true } },
        attributes: true,
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 10,
          select: { id: true, status: true, lastMessageAt: true, createdAt: true },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

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

  async update(organizationId: string, id: string, data: { name?: string; optedIn?: boolean }) {
    const contact = await this.prisma.contact.findFirst({ where: { id, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');

    const update: Parameters<typeof this.prisma.contact.update>[0]['data'] = { name: data.name };
    if (data.optedIn === true) {
      update.optedIn = true;
      update.optedOut = false;
      update.optedInAt = new Date();
    } else if (data.optedIn === false) {
      update.optedIn = false;
      update.optedOut = true;
      update.optedOutAt = new Date();
    }

    return this.prisma.contact.update({ where: { id }, data: update });
  }

  async delete(organizationId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.contact.delete({ where: { id } });
  }

  async eraseGdpr(organizationId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');

    // Anonymise rather than hard-delete so message history totals remain consistent
    await this.prisma.$transaction([
      this.prisma.contact.update({
        where: { id },
        data: {
          name: null,
          phone: `ERASED_${id.slice(0, 8)}`,
          avatarUrl: null,
          optedIn: false,
          optedOut: true,
          optedOutAt: new Date(),
        },
      }),
      this.prisma.contactAttribute.deleteMany({ where: { contactId: id } }),
    ]);
  }

  async addTag(organizationId: string, contactId: string, tagName: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');

    const tag = await this.prisma.contactTag.upsert({
      where: { organizationId_name: { organizationId, name: tagName } },
      create: { organizationId, name: tagName },
      update: {},
    });

    await this.prisma.contactTagMap.upsert({
      where: { contactId_tagId: { contactId, tagId: tag.id } },
      create: { contactId, tagId: tag.id },
      update: {},
    });

    return tag;
  }

  async removeTag(organizationId: string, contactId: string, tagId: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.contactTagMap.deleteMany({ where: { contactId, tagId } });
  }

  async setAttribute(organizationId: string, contactId: string, key: string, value: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');

    return this.prisma.contactAttribute.upsert({
      where: { contactId_key: { contactId, key } },
      create: { contactId, organizationId, key, value },
      update: { value },
    });
  }
}
