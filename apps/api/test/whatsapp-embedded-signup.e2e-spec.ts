import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { WhatsAppApiError } from '@speediator/whatsapp';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WHATSAPP_ONBOARDING_CLIENT } from '../src/whatsapp-accounts/embedded-signup.service';

// META_APP_ID, META_EMBEDDED_SIGNUP_CONFIG_ID and WHATSAPP_WEBHOOK_VERIFY_TOKEN come from test/setup-env.js.
const BUSINESS_TOKEN = 'EAAG-business-token-from-meta';

describe('WhatsApp Embedded Signup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;

  const meta = {
    exchangeCodeForToken: jest.fn(),
    getPhoneNumber: jest.fn(),
    listPhoneNumbers: jest.fn(),
    subscribeAppToWaba: jest.fn(),
    registerPhoneNumber: jest.fn(),
    requestSmbAppDataSync: jest.fn(),
  };

  async function register(slug: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ name: 'Owner', email: `owner@${slug}.test`, password: 'Password123!', orgName: slug, orgSlug: slug });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  const signup = (token: string, body: object) =>
    request(app.getHttpServer())
      .post('/v1/whatsapp-accounts/embedded-signup')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const finishSetup = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/v1/whatsapp-accounts/${id}/finish-setup`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_ONBOARDING_CLIENT)
      .useValue(meta)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    prisma = module.get(PrismaService);
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    meta.exchangeCodeForToken.mockResolvedValue(BUSINESS_TOKEN);
    meta.getPhoneNumber.mockResolvedValue({
      id: '111222333',
      display_phone_number: '+91 98765 43210',
      verified_name: 'Acme Store',
      is_on_biz_app: false,
    });
    meta.subscribeAppToWaba.mockResolvedValue(undefined);
    meta.registerPhoneNumber.mockResolvedValue(undefined);
    meta.requestSmbAppDataSync.mockResolvedValue({ request_id: 'r1' });

    await prisma.webhookEvent.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    tokenA = await register('es-a');
    tokenB = await register('es-b');
  });

  afterAll(async () => { await app.close(); });

  it('reports that Connect with Facebook is configured', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/whatsapp-accounts/embedded-signup/config')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, appId: '1234567890', configId: '9876543210' });
  });

  it('connects a new number: stores the token encrypted, links webhooks and registers it', async () => {
    const res = await signup(tokenA, { code: 'one-time-code', wabaId: '555000', phoneNumberId: '111222333', event: 'FINISH' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'CONNECTED',
      connectionMethod: 'EMBEDDED_SIGNUP',
      displayName: 'Acme Store',
      displayPhoneNumber: '+91 98765 43210',
      isOnBizApp: false,
      lastSetupError: null,
    });
    expect(res.body.webhooksSubscribedAt).toBeTruthy();
    expect(res.body.registeredAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/encrypted|Pin|EAAG/);

    expect(meta.exchangeCodeForToken).toHaveBeenCalledWith({
      code: 'one-time-code',
      appId: '1234567890',
      appSecret: 'test-app-secret',
    });
    expect(meta.subscribeAppToWaba).toHaveBeenCalledWith('555000', BUSINESS_TOKEN);
    const pin = meta.registerPhoneNumber.mock.calls[0][2];
    expect(pin).toMatch(/^\d{6}$/);
    expect(meta.requestSmbAppDataSync).not.toHaveBeenCalled();

    const stored = await prisma.whatsappAccount.findFirstOrThrow({ where: { phoneNumberId: '111222333' } });
    expect(stored.encryptedToken).not.toContain(BUSINESS_TOKEN);
    expect(stored.encryptedPin).not.toBe(pin);
  });

  it('connects a WhatsApp Business app number without registering it and requests both syncs', async () => {
    meta.listPhoneNumbers.mockResolvedValue([{ id: '444555666', display_phone_number: '+91 90000 00000', is_on_biz_app: true }]);

    const res = await signup(tokenA, {
      code: 'code',
      wabaId: '777000',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CONNECTED', isOnBizApp: true, phoneNumberId: '444555666', registeredAt: null });
    expect(res.body.contactsSyncRequestedAt).toBeTruthy();
    expect(res.body.historySyncRequestedAt).toBeTruthy();
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled();
    expect(meta.requestSmbAppDataSync.mock.calls.map((c) => c[2])).toEqual(['smb_app_state_sync', 'history']);
  });

  it('records a failed step and resumes from it on retry with the same PIN', async () => {
    meta.registerPhoneNumber.mockRejectedValueOnce(
      new WhatsAppApiError(400, { error: { message: 'Two-step verification PIN mismatch' } }),
    );

    const first = await signup(tokenA, { code: 'c', wabaId: '555000', phoneNumberId: '111222333', event: 'FINISH' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'SETUP_INCOMPLETE', lastSetupError: 'Two-step verification PIN mismatch', registeredAt: null });

    const retry = await finishSetup(tokenA, first.body.id);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: 'CONNECTED', lastSetupError: null });
    expect(meta.subscribeAppToWaba).toHaveBeenCalledTimes(1);
    expect(meta.registerPhoneNumber).toHaveBeenCalledTimes(2);
    expect(meta.registerPhoneNumber.mock.calls[1][2]).toBe(meta.registerPhoneNumber.mock.calls[0][2]);
  });

  it('connecting the same number again updates it instead of duplicating', async () => {
    await signup(tokenA, { code: 'c1', wabaId: '555000', phoneNumberId: '111222333', event: 'FINISH' });
    const again = await signup(tokenA, { code: 'c2', wabaId: '555000', phoneNumberId: '111222333', event: 'FINISH' });

    expect(again.status).toBe(201);
    expect(await prisma.whatsappAccount.count()).toBe(1);
    expect(meta.registerPhoneNumber).toHaveBeenCalledTimes(1);
  });

  it("keeps organizations apart: no retrying another org's account, no taking its number", async () => {
    const a = await signup(tokenA, { code: 'c', wabaId: '555000', phoneNumberId: '111222333', event: 'FINISH' });

    const retryAsB = await finishSetup(tokenB, a.body.id);
    expect(retryAsB.status).toBe(404);

    const takeNumber = await signup(tokenB, { code: 'c', wabaId: '555000', phoneNumberId: '111222333', event: 'FINISH' });
    expect(takeNumber.status).toBe(409);

    const listB = await request(app.getHttpServer()).get('/v1/whatsapp-accounts').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body).toEqual([]);
  });

  it('explains an expired or rejected code', async () => {
    meta.exchangeCodeForToken.mockRejectedValue(new WhatsAppApiError(400, { error: { message: 'expired' } }));

    const res = await signup(tokenA, { code: 'old', wabaId: '555000', phoneNumberId: '111222333', event: 'FINISH' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('5 minutes');
    expect(await prisma.whatsappAccount.count()).toBe(0);
  });

  it('rejects malformed IDs and unknown finish events', async () => {
    const res = await signup(tokenA, { code: 'c', wabaId: 'not-a-number', event: 'FINISH_ONLY_WABA' });
    expect(res.status).toBe(400);
  });

  it('answers Meta webhook verification with the app-level token', async () => {
    const ok = await request(app.getHttpServer()).get('/v1/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'app-level-verify-token-for-tests',
      'hub.challenge': '424242',
    });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('424242');

    const bad = await request(app.getHttpServer()).get('/v1/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token-of-similar-length-xx',
      'hub.challenge': '1',
    });
    expect(bad.status).toBe(403);
  });
});
