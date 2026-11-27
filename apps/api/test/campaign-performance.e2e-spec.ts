import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Campaign audience and performance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  async function setupOrg(slug: string) {
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: `owner@${slug}.test`, password: 'Password123!', orgName: slug, orgSlug: slug });
    const token = reg.body.accessToken as string;
    const wa = await request(app.getHttpServer())
      .post('/v1/whatsapp-accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ wabaId: `waba-${slug}`, phoneNumberId: `pn-${slug}`, displayName: slug, accessToken: 'tok' });
    const org = await prisma.organization.findFirstOrThrow({ where: { slug } });
    const template = await prisma.template.create({
      data: { organizationId: org.id, whatsappAccountId: wa.body.id, name: `t_${slug.replace(/-/g, '_')}`, language: 'en', category: 'MARKETING', status: 'APPROVED', components: [] },
    });
    return { token, orgId: org.id, accountId: wa.body.id as string, templateId: template.id };
  }

  const api = (token: string) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object) => request(app.getHttpServer()).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    prisma = module.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.campaignContact.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.template.deleteMany();
    await prisma.contactTagMap.deleteMany();
    await prisma.contactTag.deleteMany();
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

  it('previews only opted-in contacts, and never counts another organization\'s contacts', async () => {
    const a = await setupOrg('perf-a');
    const b = await setupOrg('perf-b');
    const [inA, outA] = await Promise.all([
      prisma.contact.create({ data: { organizationId: a.orgId, phone: '911', optedIn: true } }),
      prisma.contact.create({ data: { organizationId: a.orgId, phone: '912', optedIn: false } }),
    ]);
    const inB = await prisma.contact.create({ data: { organizationId: b.orgId, phone: '913', optedIn: true } });

    expect((await api(a.token).post('/campaigns/audience-preview', { audienceFilter: { mode: 'all' } })).body).toEqual({ count: 1 });
    const picked = await api(a.token).post('/campaigns/audience-preview', {
      audienceFilter: { mode: 'contacts', contactIds: [inA.id, outA.id, inB.id] },
    });
    expect(picked.body).toEqual({ count: 1 });
  });

  it('rejects an empty or malformed audience', async () => {
    const a = await setupOrg('perf-c');
    const res = await api(a.token).post('/campaigns', {
      name: 'x', whatsappAccountId: a.accountId, templateId: a.templateId, audienceFilter: { mode: 'contacts', contactIds: [] },
    });
    expect(res.status).toBe(400);
  });

  it('reports delivery funnel numbers and lists recipients for the owner only', async () => {
    const a = await setupOrg('perf-d');
    const b = await setupOrg('perf-e');
    const created = await api(a.token).post('/campaigns', { name: 'Sale', whatsappAccountId: a.accountId, templateId: a.templateId });
    expect(created.status).toBe(201);
    const campaignId = created.body.id as string;

    const statuses = ['READ', 'READ', 'DELIVERED', 'SENT', 'FAILED', 'SKIPPED_OPTED_OUT', 'PENDING'] as const;
    for (const [i, status] of statuses.entries()) {
      const contact = await prisma.contact.create({ data: { organizationId: a.orgId, phone: `9100${i}`, name: `C${i}`, optedIn: true } });
      await prisma.campaignContact.create({ data: { campaignId, contactId: contact.id, status, error: status === 'FAILED' ? 'Number not on WhatsApp' : null } });
    }

    const analytics = await api(a.token).get(`/campaigns/${campaignId}/analytics`);
    expect(analytics.body).toEqual({
      total: 7, pending: 1, sent: 4, delivered: 3, read: 2, failed: 1, skipped: 1, deliveryRate: 75, readRate: 67,
    });

    const failed = await api(a.token).get(`/campaigns/${campaignId}/recipients?status=failed`);
    expect(failed.body.total).toBe(1);
    expect(failed.body.items[0]).toMatchObject({ status: 'FAILED', error: 'Number not on WhatsApp', contact: { name: 'C4' } });

    expect((await api(b.token).get(`/campaigns/${campaignId}/analytics`)).status).toBe(404);
    expect((await api(b.token).get(`/campaigns/${campaignId}/recipients`)).status).toBe(404);
  });
});
