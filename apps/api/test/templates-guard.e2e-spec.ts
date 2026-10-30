import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TemplatesService } from '../src/templates/templates.service';

describe('Templates guard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let templatesService: TemplatesService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    prisma = module.get(PrismaService);
    templatesService = module.get(TemplatesService);
  });

  beforeEach(async () => {
    await prisma.template.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => { await app.close(); });

  it('assertApproved throws for a REJECTED template', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: 'owner@tmpl.test', password: 'Password123!', orgName: 'TmplOrg', orgSlug: 'tmpl-org' });
    expect(regRes.status).toBe(201);

    const { accessToken } = regRes.body as { accessToken: string };

    const waRes = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ wabaId: 'waba1', phoneNumberId: '15550009999', displayName: 'Test', accessToken: 'fake' });
    expect(waRes.status).toBe(201);

    const org = await prisma.organization.findFirst({ where: { slug: 'tmpl-org' } });

    // Directly create a REJECTED template
    const template = await prisma.template.create({
      data: {
        organizationId: org!.id,
        whatsappAccountId: waRes.body.id,
        name: 'rejected_template',
        language: 'en',
        category: 'MARKETING',
        status: 'REJECTED',
        components: [],
        rejectionReason: 'Policy violation',
      },
    });

    // assertApproved should throw BadRequestException
    await expect(
      templatesService.assertApproved(org!.id, template.id),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('assertApproved passes for an APPROVED template', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: 'owner2@tmpl.test', password: 'Password123!', orgName: 'TmplOrg2', orgSlug: 'tmpl-org2' });

    const { accessToken } = regRes.body as { accessToken: string };
    const waRes = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ wabaId: 'waba2', phoneNumberId: '15550008888', displayName: 'Test', accessToken: 'fake' });

    const org = await prisma.organization.findFirst({ where: { slug: 'tmpl-org2' } });

    const template = await prisma.template.create({
      data: {
        organizationId: org!.id,
        whatsappAccountId: waRes.body.id,
        name: 'approved_template',
        language: 'en',
        category: 'UTILITY',
        status: 'APPROVED',
        components: [],
      },
    });

    const result = await templatesService.assertApproved(org!.id, template.id);
    expect(result.status).toBe('APPROVED');
  });

  it('org B cannot see org A templates', async () => {
    const tokensA = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'A', email: 'a@tmpl.test', password: 'Password123!', orgName: 'TmplA', orgSlug: 'tmpl-a' });
    const tokensB = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'B', email: 'b@tmpl.test', password: 'Password123!', orgName: 'TmplB', orgSlug: 'tmpl-b' });

    const tokenA = tokensA.body.accessToken as string;
    const tokenB = tokensB.body.accessToken as string;

    const waA = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ wabaId: 'waba-a', phoneNumberId: '155500011111', displayName: 'A', accessToken: 'fake' });

    const orgA = await prisma.organization.findFirst({ where: { slug: 'tmpl-a' } });
    await prisma.template.create({
      data: {
        organizationId: orgA!.id,
        whatsappAccountId: waA.body.id,
        name: 'secret_template',
        language: 'en',
        category: 'MARKETING',
        status: 'APPROVED',
        components: [],
      },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/templates')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });
});
