import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Campaigns (e2e)', () => {
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
    await prisma.campaignContact.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.template.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.webhookEvent.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndLogin(email: string, orgName: string, orgSlug: string) {
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email, password: 'Password123!', orgName, orgSlug });
    expect(reg.status).toBe(201);
    return reg.body as { accessToken: string; user: { id: string }; organization: { id: string } };
  }

  async function createApprovedTemplate(accessToken: string, waAccountId: string) {
    const org = await prisma.organization.findFirst({ where: { whatsappAccounts: { some: { id: waAccountId } } } });
    return prisma.template.create({
      data: {
        organizationId: org!.id,
        whatsappAccountId: waAccountId,
        name: 'hello_world',
        language: 'en',
        category: 'MARKETING',
        status: 'APPROVED',
        components: [],
      },
    });
  }

  it('org B cannot access org A campaigns', async () => {
    const orgA = await registerAndLogin('cam-ownera@test.com', 'CamOrgA', 'cam-org-a');
    const orgB = await registerAndLogin('cam-ownerb@test.com', 'CamOrgB', 'cam-org-b');

    // Create a WhatsApp account + template for Org A
    const waA = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ wabaId: 'waba_a', phoneNumberId: 'phone_a', displayName: 'A', accessToken: 'tok' });
    expect(waA.status).toBe(201);
    const template = await createApprovedTemplate(orgA.accessToken, waA.body.id);

    // Create campaign in Org A
    const camRes = await request(app.getHttpServer())
      .post('/v1/campaigns')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ name: 'Camp A', whatsappAccountId: waA.body.id, templateId: template.id });
    expect(camRes.status).toBe(201);
    const campaignId = camRes.body.id;

    // Org B tries to get Org A's campaign
    const getRes = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(getRes.status).toBe(404);

    // Org B lists campaigns — should be empty
    const listRes = await request(app.getHttpServer())
      .get('/v1/campaigns')
      .set('Authorization', `Bearer ${orgB.accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(0);
  });

  it('opted-out contacts are not enqueued in audience count', async () => {
    const orgA = await registerAndLogin('cam-owneraa@test.com', 'CamOrgAA', 'cam-org-aa');
    const waA = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ wabaId: 'waba_aa', phoneNumberId: 'phone_aa', displayName: 'AA', accessToken: 'tok' });
    expect(waA.status).toBe(201);
    const template = await createApprovedTemplate(orgA.accessToken, waA.body.id);

    const org = await prisma.organization.findFirst({ where: { whatsappAccounts: { some: { id: waA.body.id } } } });

    // Create one opted-in and one opted-out contact
    await prisma.contact.createMany({
      data: [
        { organizationId: org!.id, phone: '911111111111', name: 'Opt-In', optedIn: true },
        { organizationId: org!.id, phone: '912222222222', name: 'Opt-Out', optedIn: false },
      ],
    });

    const camRes = await request(app.getHttpServer())
      .post('/v1/campaigns')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ name: 'Test Camp', whatsappAccountId: waA.body.id, templateId: template.id });
    expect(camRes.status).toBe(201);

    // Audience count should only include opted-in contacts
    const countRes = await request(app.getHttpServer())
      .get(`/v1/campaigns/${camRes.body.id}/audience-count`)
      .set('Authorization', `Bearer ${orgA.accessToken}`);
    expect(countRes.status).toBe(200);
    expect(countRes.body.count).toBe(1);
  });
});
