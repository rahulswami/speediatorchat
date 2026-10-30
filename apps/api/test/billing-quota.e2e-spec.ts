import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Billing (e2e)', () => {
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
    await prisma.subscription.deleteMany();
    await prisma.usageRecord.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /billing/subscription returns a trial subscription for a new org', async () => {
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: 'billing@test.com', password: 'Password123!', orgName: 'BillOrg', orgSlug: 'bill-org' });
    expect(reg.status).toBe(201);
    const { accessToken } = reg.body as { accessToken: string };

    const subRes = await request(app.getHttpServer())
      .get('/v1/billing/subscription')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(subRes.status).toBe(200);
    expect(subRes.body.plan).toBe('STARTER');
    expect(subRes.body.status).toBe('TRIALING');
  });

  it('GET /billing/usage returns plan limits', async () => {
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: 'billing2@test.com', password: 'Password123!', orgName: 'BillOrg2', orgSlug: 'bill-org-2' });
    expect(reg.status).toBe(201);
    const { accessToken } = reg.body as { accessToken: string };

    const usageRes = await request(app.getHttpServer())
      .get('/v1/billing/usage')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(usageRes.status).toBe(200);
    expect(usageRes.body.limits).toMatchObject({ contacts: 1000, campaigns: 5, agents: 2 });
    expect(usageRes.body.plan).toBe('STARTER');
  });
});
