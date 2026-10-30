import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Contacts opt-out (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  afterAll(async () => { await app.close(); });

  it('cannot send message to an opted-out contact', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: 'owner@optout.test', password: 'Password123!', orgName: 'OptOutOrg', orgSlug: 'optout-org' });
    expect(regRes.status).toBe(201);

    const { accessToken } = regRes.body as { accessToken: string };

    const waRes = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ wabaId: 'waba1', phoneNumberId: '15550001111', displayName: 'Test', accessToken: 'fake' });
    expect(waRes.status).toBe(201);

    const org = await prisma.organization.findFirst({ where: { slug: 'optout-org' } });

    // Create opted-out contact
    const contact = await prisma.contact.create({
      data: {
        organizationId: org!.id,
        phone: '+919876543210',
        name: 'Opted Out',
        optedOut: true,
        optedIn: false,
        optedOutAt: new Date(),
      },
    });

    // Create conversation with open session
    const conv = await prisma.conversation.create({
      data: {
        organizationId: org!.id,
        contactId: contact.id,
        whatsappAccountId: waRes.body.id,
        sessionExpiresAt: new Date(Date.now() + 3600000),
        lastMessageAt: new Date(),
      },
    });

    // Try to send — should fail because contact is opted out
    const res = await request(app.getHttpServer())
      .post(`/v1/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ body: 'Hello!' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/opted out/i);
  });

  it('PATCH /contacts/:id can opt in a contact', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: 'owner2@optout.test', password: 'Password123!', orgName: 'OptInOrg', orgSlug: 'optin-org' });

    const { accessToken } = regRes.body as { accessToken: string };
    const org = await prisma.organization.findFirst({ where: { slug: 'optin-org' } });

    const contact = await prisma.contact.create({
      data: { organizationId: org!.id, phone: '+919876543211', optedOut: true, optedIn: false },
    });

    const res = await request(app.getHttpServer())
      .patch(`/v1/contacts/${contact.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ optedIn: true });

    expect(res.status).toBe(200);
    expect(res.body.optedIn).toBe(true);
    expect(res.body.optedOut).toBe(false);
  });
});
