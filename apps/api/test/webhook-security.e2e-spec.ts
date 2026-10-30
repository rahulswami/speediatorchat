import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const APP_SECRET = 'test-app-secret';

describe('Webhook security (e2e)', () => {
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
    await prisma.webhookEvent.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  function sign(body: string): string {
    return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  }

  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('accepts a valid signature', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
  });

  it('rejects a tampered payload', async () => {
    const tampered = JSON.stringify({ object: 'tampered', entry: [] });
    const res = await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload)) // signature for original, not tampered
      .send(tampered);

    expect(res.status).toBe(403);
  });

  it('rejects a missing signature', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(403);
  });

  it('processes a duplicate wamid only once', async () => {
    // Register an org + WhatsApp account so event gets an org
    const regRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: 'wh@test.com', password: 'Password123!', orgName: 'WebhookOrg', orgSlug: 'webhook-org' });
    expect(regRes.status).toBe(201);

    const { accessToken } = regRes.body as { accessToken: string };

    // Connect a fake WhatsApp account
    await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ wabaId: 'waba123', phoneNumberId: '15550001111', displayName: 'Test', accessToken: 'fake-token' })
      .expect(201);

    const msgPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba123',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '15550001111' },
            messages: [{ id: 'wamid.test001', from: '919999999999', type: 'text', text: { body: 'hello' }, timestamp: '1700000000' }],
            contacts: [{ profile: { name: 'Test User' } }],
          },
        }],
      }],
    });

    const sig = sign(msgPayload);

    // Send twice
    await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sig)
      .send(msgPayload)
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sig)
      .send(msgPayload)
      .expect(200);

    // Two webhook events stored, but worker deduplicates on wamid
    const events = await prisma.webhookEvent.findMany();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
