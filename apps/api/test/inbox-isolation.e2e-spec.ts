import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Inbox isolation (e2e)', () => {
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
    await prisma.webhookEvent.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => { await app.close(); });

  async function register(slug: string, email: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email, password: 'Password123!', orgName: slug, orgSlug: slug });
    expect(res.status).toBe(201);
    return res.body as { accessToken: string };
  }

  async function connectWA(token: string, phoneNumberId: string, wabaId = 'waba1') {
    const res = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ wabaId, phoneNumberId, displayName: 'Test', accessToken: 'fake' });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  async function seedConversation(orgId: string, waAccountId: string) {
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, phone: `+91${Date.now()}`, name: 'Test' },
    });
    const conv = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        whatsappAccountId: waAccountId,
        sessionExpiresAt: new Date(Date.now() + 3600000),
        lastMessageAt: new Date(),
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        organizationId: orgId,
        direction: 'INBOUND',
        type: 'text',
        content: { body: 'secret message' },
        metaMessageId: `wamid-${Date.now()}`,
        status: 'DELIVERED',
      },
    });
    return conv;
  }

  it('org B cannot see org A conversations', async () => {
    const { accessToken: tokenA } = await register('inbox-a', 'ownerA@inbox.test');
    const { accessToken: tokenB } = await register('inbox-b', 'ownerB@inbox.test');

    const orgA = await prisma.organization.findFirst({ where: { slug: 'inbox-a' } });
    const orgB = await prisma.organization.findFirst({ where: { slug: 'inbox-b' } });

    const accountA = await connectWA(tokenA, '15550001111');
    const accountB = await connectWA(tokenB, '15550002222');

    await seedConversation(orgA!.id, accountA.id);
    await seedConversation(orgB!.id, accountB.id);

    const resA = await request(app.getHttpServer())
      .get('/v1/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const resB = await request(app.getHttpServer())
      .get('/v1/conversations')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(resA.body.items).toHaveLength(1);
    expect(resB.body.items).toHaveLength(1);

    // Org B should not see Org A's conversation
    const orgBConvIds = resB.body.items.map((c: { id: string }) => c.id);
    const orgAConvId = resA.body.items[0].id;
    expect(orgBConvIds).not.toContain(orgAConvId);
  });

  it('org B cannot read messages from org A conversation', async () => {
    const { accessToken: tokenA } = await register('inbox-c', 'ownerC@inbox.test');
    const { accessToken: tokenB } = await register('inbox-d', 'ownerD@inbox.test');

    const orgA = await prisma.organization.findFirst({ where: { slug: 'inbox-c' } });
    const accountA = await connectWA(tokenA, '15550003333');

    const convA = await seedConversation(orgA!.id, accountA.id);

    // Org B tries to read Org A's messages
    const res = await request(app.getHttpServer())
      .get(`/v1/conversations/${convA.id}/messages`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect([403, 404]).toContain(res.status);
  });
});
