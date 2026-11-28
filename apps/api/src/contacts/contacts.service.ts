import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from './phone';

const MANUAL_OPT_IN_SOURCE = 'Dashboard (manual)';

interface OptInChoice {
  optedIn: boolean;
  optInSource?: string;
  defaultCountryCode: string;
}

export interface NewContactInput extends OptInChoice {
  phone: string;
  name?: string;
}

export interface ImportContactsInput extends OptInChoice {
  rows: Array<{ phone: string; name?: string }>;
}

export interface SkippedRow {
  row: number;
  phone: string;
  reason: string;
}

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

  /** Tags with how many opted-in contacts each would reach in a campaign. */
  async listTags(organizationId: string) {
    const tags = await this.prisma.contactTag.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { contacts: { where: { contact: { optedIn: true, optedOut: false } } } } },
      },
    });
    return tags.map(({ _count, ...t }) => ({ ...t, optedInCount: _count.contacts }));
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

  async create(organizationId: string, input: NewContactInput) {
    const phone = normalizePhone(input.phone, input.defaultCountryCode);
    if (!phone) throw new BadRequestException({ phone: ['Invalid phone number'] });

    const existing = await this.prisma.contact.findUnique({
      where: { organizationId_phone: { organizationId, phone } },
    });
    if (existing) throw new ConflictException('A contact with this phone number already exists');

    return this.prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: input.name,
        ...(input.optedIn
          ? { optedIn: true, optedInAt: new Date(), optInSource: input.optInSource }
          : {}),
      },
    });
  }

  async import(organizationId: string, input: ImportContactsInput) {
    const skipped: SkippedRow[] = [];
    const names = new Map<string, string | undefined>();

    input.rows.forEach((r, i) => {
      const row = i + 1;
      const phone = normalizePhone(r.phone, input.defaultCountryCode);
      if (!phone) skipped.push({ row, phone: r.phone, reason: 'Invalid phone number' });
      else if (names.has(phone)) skipped.push({ row, phone: r.phone, reason: 'Duplicate in file' });
      else names.set(phone, r.name);
    });

    const phones = [...names.keys()];
    const existing = await this.prisma.contact.findMany({
      where: { organizationId, phone: { in: phones } },
      select: { id: true, phone: true, name: true, optedIn: true, optedOut: true },
    });
    const existingByPhone = new Map(existing.map((c) => [c.phone, c]));

    const now = new Date();
    const optInFields = { optedIn: true, optedInAt: now, optInSource: input.optInSource };

    const toCreate = phones
      .filter((phone) => !existingByPhone.has(phone))
      .map((phone) => ({
        organizationId,
        phone,
        name: names.get(phone),
        ...(input.optedIn ? optInFields : {}),
      }));

    let keptOptedOut = 0;
    const updates = existing.flatMap((c) => {
      const name = names.get(c.phone);
      const data: { name?: string; optedIn?: boolean; optedInAt?: Date; optInSource?: string } = {};
      if (name && name !== c.name) data.name = name;
      // Someone who replied STOP stays opted out: an imported list is not fresh consent.
      if (input.optedIn && c.optedOut) keptOptedOut++;
      else if (input.optedIn && !c.optedIn) Object.assign(data, optInFields);
      return Object.keys(data).length
        ? [this.prisma.contact.update({ where: { id: c.id }, data })]
        : [];
    });

    const [createResult] = await this.prisma.$transaction([
      this.prisma.contact.createMany({ data: toCreate, skipDuplicates: true }),
      ...updates,
    ]);

    return {
      created: createResult.count,
      updated: updates.length,
      unchanged: existing.length - updates.length,
      keptOptedOut,
      skipped,
    };
  }

  async update(
    organizationId: string,
    id: string,
    data: { name?: string | null; optedIn?: boolean; optInSource?: string },
  ) {
    const contact = await this.prisma.contact.findFirst({ where: { id, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');

    const update: Parameters<typeof this.prisma.contact.update>[0]['data'] = {};
    if (data.name !== undefined) update.name = data.name;
    // Only a change of consent touches the opt-in record, so editing a name keeps its history.
    if (data.optedIn === true && (!contact.optedIn || contact.optedOut)) {
      update.optedIn = true;
      update.optedOut = false;
      update.optedInAt = new Date();
      update.optInSource = data.optInSource || MANUAL_OPT_IN_SOURCE;
    } else if (data.optedIn === false && !contact.optedOut) {
      update.optedIn = false;
      update.optedOut = true;
      update.optedOutAt = new Date();
    }

    return this.prisma.contact.update({ where: { id: contact.id }, data: update });
  }

  async delete(organizationId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, organizationId } });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.contact.delete({ where: { id: contact.id } });
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
