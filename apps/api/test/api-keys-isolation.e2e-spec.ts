import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ApiKeysService } from '../src/api-keys/api-keys.service';

describe('API Key isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let apiKeysService: ApiKeysService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    prisma = module.get(PrismaService);
    apiKeysService = module.get(ApiKeysService);
  });

  beforeEach(async () => {
    await prisma.apiKey.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.webhookEvent.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('API keys for org A and org B are separate', async () => {
    // Register Org A
    const regA = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'OwnerA', email: 'apikey-a@test.com', password: 'Password123!', orgName: 'ApiOrgA', orgSlug: 'api-org-a' });
    expect(regA.status).toBe(201);
    const { accessToken: tokenA, user: userA } = regA.body as { accessToken: string; user: { id: string } };

    // Register Org B
    const regB = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'OwnerB', email: 'apikey-b@test.com', password: 'Password123!', orgName: 'ApiOrgB', orgSlug: 'api-org-b' });
    expect(regB.status).toBe(201);
    const { accessToken: tokenB } = regB.body as { accessToken: string };

    // Create API key for Org A
    const keyResA = await request(app.getHttpServer())
      .post('/v1/api-keys')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Key A', scopes: ['read:contacts'] });
    expect(keyResA.status).toBe(201);
    expect(keyResA.body.key).toMatch(/^sk_/);

    // Org B lists API keys — should be empty
    const listResB = await request(app.getHttpServer())
      .get('/v1/api-keys')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listResB.status).toBe(200);
    expect(listResB.body).toHaveLength(0);

    // Org A lists API keys — should have 1
    const listResA = await request(app.getHttpServer())
      .get('/v1/api-keys')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listResA.status).toBe(200);
    expect(listResA.body).toHaveLength(1);
  });
});
