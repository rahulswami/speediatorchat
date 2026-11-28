import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Overview report, contact edits and template variables (e2e)', () => {
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
    return { token, orgId: org.id, accountId: wa.body.id as string };
  }

  const api = (token: string) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object) => request(app.getHttpServer()).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    delete: (path: string) => request(app.getHttpServer()).delete(`/v1${path}`).set('Authorization', `Bearer ${token}`),
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

  it('counts only the signed-in organization\'s data on the overview', async () => {
    const a = await setupOrg('ov-a');
    const b = await setupOrg('ov-b');
    const contactA = await prisma.contact.create({ data: { organizationId: a.orgId, phone: '9101', optedIn: true } });
    const contactB = await prisma.contact.create({ data: { organizationId: b.orgId, phone: '9102' } });
    const convA = await prisma.conversation.create({ data: { organizationId: a.orgId, contactId: contactA.id, whatsappAccountId: a.accountId, status: 'OPEN' } });
    const convB = await prisma.conversation.create({ data: { organizationId: b.orgId, contactId: contactB.id, whatsappAccountId: b.accountId, status: 'OPEN' } });
    await prisma.message.createMany({
      data: [
        { organizationId: a.orgId, conversationId: convA.id, direction: 'OUTBOUND', content: {}, status: 'READ' },
        { organizationId: a.orgId, conversationId: convA.id, direction: 'INBOUND', content: {}, status: 'DELIVERED' },
        { organizationId: b.orgId, conversationId: convB.id, direction: 'OUTBOUND', content: {}, status: 'FAILED' },
      ],
    });

    const res = await api(a.token).get('/overview?days=7');
    expect(res.status).toBe(200);
    expect(res.body.contacts).toMatchObject({ total: 1, optedIn: 1 });
    expect(res.body.conversations.open).toBe(1);
    expect(res.body.messages).toMatchObject({ outbound: 1, inbound: 1, sent: 1, delivered: 1, read: 1, failed: 0 });
    expect(res.body.daily).toHaveLength(7);
    expect(res.body.daily.reduce((n: number, d: { outbound: number }) => n + d.outbound, 0)).toBe(1);

    expect((await api(a.token).get('/overview?days=12')).status).toBe(400);
  });

  it('lets an organization edit and delete only its own contacts', async () => {
    const a = await setupOrg('ce-a');
    const b = await setupOrg('ce-b');
    const contactB = await prisma.contact.create({ data: { organizationId: b.orgId, phone: '9201', name: 'B' } });

    expect((await api(a.token).patch(`/contacts/${contactB.id}`, { name: 'Hacked' })).status).toBe(404);
    expect((await api(a.token).delete(`/contacts/${contactB.id}`)).status).toBe(404);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactB.id } })).name).toBe('B');

    const own = await prisma.contact.create({ data: { organizationId: a.orgId, phone: '9202' } });
    const edited = await api(a.token).patch(`/contacts/${own.id}`, { name: 'Anita', optedIn: true, optInSource: 'Store sign-up' });
    expect(edited.body).toMatchObject({ name: 'Anita', optedIn: true, optInSource: 'Store sign-up' });
    expect((await api(a.token).delete(`/contacts/${own.id}`)).status).toBe(204);
  });

  it('refuses a campaign that leaves template variables empty', async () => {
    const a = await setupOrg('cv-a');
    const template = await prisma.template.create({
      data: {
        organizationId: a.orgId, whatsappAccountId: a.accountId, name: 'offer', language: 'en', category: 'MARKETING',
        status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, use {{2}}' }],
      },
    });
    const base = { name: 'x', whatsappAccountId: a.accountId, templateId: template.id };

    const missing = await api(a.token).post('/campaigns', base);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('Body {{1}} needs a value');

    const ok = await api(a.token).post('/campaigns', {
      ...base,
      variableMap: {
        values: {
          'body.1': { source: 'contact', field: 'name', fallback: 'there' },
          'body.2': { source: 'static', value: 'SAVE10' },
        },
      },
    });
    expect(ok.status).toBe(201);
  });

  it('rejects a template with missing example values before calling Meta', async () => {
    const a = await setupOrg('tv-a');
    const res = await api(a.token).post('/templates', {
      whatsappAccountId: a.accountId,
      name: 'promo',
      language: 'en',
      category: 'MARKETING',
      body: { text: 'Hi {{1}}', examples: [] },
    });
    expect(res.status).toBe(400);
  });
});
