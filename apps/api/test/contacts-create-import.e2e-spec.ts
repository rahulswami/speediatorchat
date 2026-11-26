import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Contacts create and import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let orgAId: string;

  async function register(slug: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: `owner@${slug}.test`, password: 'Password123!', orgName: slug, orgSlug: slug });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  const post = (path: string, token: string, body: object) =>
    request(app.getHttpServer()).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    prisma = module.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    tokenA = await register('contacts-a');
    tokenB = await register('contacts-b');
    orgAId = (await prisma.organization.findFirstOrThrow({ where: { slug: 'contacts-a' } })).id;
  });

  afterAll(async () => { await app.close(); });

  describe('POST /v1/contacts', () => {
    it('stores the phone in inbound-webhook format and records where consent came from', async () => {
      const res = await post('/contacts', tokenA, {
        phone: '+91 98765 43210',
        name: 'Priya',
        optedIn: true,
        optInSource: 'Website form',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ phone: '919876543210', name: 'Priya', optedIn: true, optInSource: 'Website form' });
      expect(res.body.optedInAt).toBeTruthy();
    });

    it('adds the default country code to 10-digit numbers', async () => {
      const res = await post('/contacts', tokenA, { phone: '9876543210' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ phone: '919876543210', optedIn: false });
    });

    it('requires a consent source when opting in', async () => {
      const res = await post('/contacts', tokenA, { phone: '9876543210', optedIn: true });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('optInSource');
    });

    it('rejects an invalid phone number', async () => {
      const res = await post('/contacts', tokenA, { phone: '12345' });
      expect(res.status).toBe(400);
    });

    it('rejects a phone number the organization already has', async () => {
      await post('/contacts', tokenA, { phone: '919876543210' });
      const res = await post('/contacts', tokenA, { phone: '+91 98765 43210' });
      expect(res.status).toBe(409);
    });

    it('lets another organization add the same phone without seeing or touching the first one', async () => {
      await post('/contacts', tokenA, { phone: '9876543210', name: 'A contact' });

      const createB = await post('/contacts', tokenB, { phone: '9876543210', name: 'B contact' });
      expect(createB.status).toBe(201);

      const listB = await request(app.getHttpServer())
        .get('/v1/contacts')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body.items.map((c: { name: string }) => c.name)).toEqual(['B contact']);

      const contactA = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgAId } });
      expect(contactA.name).toBe('A contact');
    });
  });

  describe('POST /v1/contacts/import', () => {
    it('creates new contacts, updates existing ones and reports skipped rows', async () => {
      // Same person who already messaged in: stored by the webhook as digits only.
      await prisma.contact.create({ data: { organizationId: orgAId, phone: '919876543210' } });

      const res = await post('/contacts/import', tokenA, {
        rows: [
          { phone: '+91 98765 43210', name: 'Existing' },
          { phone: '9123456789', name: 'New one' },
          { phone: '91234 56789', name: 'Same as row 2' },
          { phone: 'not a number' },
        ],
        optedIn: true,
        optInSource: 'Offline event sign-up sheet',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ created: 1, updated: 1, unchanged: 0, keptOptedOut: 0 });
      expect(res.body.skipped).toEqual([
        { row: 3, phone: '91234 56789', reason: 'Duplicate in file' },
        { row: 4, phone: 'not a number', reason: 'Invalid phone number' },
      ]);

      const contacts = await prisma.contact.findMany({ where: { organizationId: orgAId }, orderBy: { phone: 'asc' } });
      expect(contacts).toHaveLength(2);
      expect(contacts.every((c) => c.optedIn && c.optInSource === 'Offline event sign-up sheet')).toBe(true);
      expect(contacts.find((c) => c.phone === '919876543210')?.name).toBe('Existing');
    });

    it('keeps contacts who replied STOP opted out', async () => {
      await prisma.contact.create({
        data: { organizationId: orgAId, phone: '919876543210', optedOut: true, optedOutAt: new Date() },
      });

      const res = await post('/contacts/import', tokenA, {
        rows: [{ phone: '9876543210' }],
        optedIn: true,
        optInSource: 'Old customer list',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ created: 0, updated: 0, unchanged: 1, keptOptedOut: 1 });
      const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgAId } });
      expect(contact).toMatchObject({ optedIn: false, optedOut: true });
    });

    it("never changes another organization's contacts", async () => {
      await prisma.contact.create({ data: { organizationId: orgAId, phone: '919876543210', name: 'Keep me' } });

      const res = await post('/contacts/import', tokenB, {
        rows: [{ phone: '9876543210', name: 'Overwritten?' }],
        optedIn: true,
        optInSource: 'B list',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ created: 1, updated: 0 });
      const contactA = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgAId } });
      expect(contactA).toMatchObject({ name: 'Keep me', optedIn: false, optInSource: null });
    });

    it('requires a consent source when opting in and caps the file size', async () => {
      const noSource = await post('/contacts/import', tokenA, { rows: [{ phone: '9876543210' }], optedIn: true });
      expect(noSource.status).toBe(400);

      const tooMany = await post('/contacts/import', tokenA, {
        rows: Array.from({ length: 5001 }, (_, i) => ({ phone: String(9000000000 + i) })),
      });
      expect(tooMany.status).toBe(400);
    });

    it('requires a signed-in user', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/contacts/import')
        .send({ rows: [{ phone: '9876543210' }] });
      expect(res.status).toBe(401);
    });
  });
});
