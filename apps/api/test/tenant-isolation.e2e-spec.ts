import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter, configureApp } from '../src/create-app';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Tenant isolation (e2e)', () => {
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
    await prisma.invite.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerOrg(orgSlug: string, email: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        name: 'Owner',
        email,
        password: 'Password123!',
        orgName: orgSlug,
        orgSlug,
      });
    expect(res.status).toBe(201);
    return res.body as { accessToken: string; refreshToken: string };
  }

  it('returns only its own members', async () => {
    const tokensA = await registerOrg('org-a', 'ownerA@test.com');
    const tokensB = await registerOrg('org-b', 'ownerB@test.com');

    // Create a pending invite in Org A (adds no new member yet)
    await request(app.getHttpServer())
      .post('/v1/invites')
      .set('Authorization', `Bearer ${tokensA.accessToken}`)
      .send({ email: 'member@orga.com', role: 'AGENT' })
      .expect(201);

    // Org B lists its members — should see only its own owner (1 member)
    const membersB = await request(app.getHttpServer())
      .get('/v1/members')
      .set('Authorization', `Bearer ${tokensB.accessToken}`)
      .expect(200);

    expect(membersB.body).toHaveLength(1);
    expect(membersB.body[0].user.email).toBe('ownerB@test.com');
  });

  it('cannot delete a member from another org', async () => {
    const tokensA = await registerOrg('org-a-del', 'ownerA2@test.com');
    const tokensB = await registerOrg('org-b-del', 'ownerB2@test.com');

    // Get Org A's owner user id via members list
    const membersA = await request(app.getHttpServer())
      .get('/v1/members')
      .set('Authorization', `Bearer ${tokensA.accessToken}`)
      .expect(200);
    const orgAUserId: string = membersA.body[0].user.id;

    // Org B tries to delete Org A's member — must be 403 or 404
    const res = await request(app.getHttpServer())
      .delete(`/v1/members/${orgAUserId}`)
      .set('Authorization', `Bearer ${tokensB.accessToken}`);

    expect([403, 404]).toContain(res.status);
  });

  it('cannot see invites from another org', async () => {
    const tokensA = await registerOrg('org-a-inv', 'ownerA3@test.com');
    const tokensB = await registerOrg('org-b-inv', 'ownerB3@test.com');

    // Create an invite in Org A
    await request(app.getHttpServer())
      .post('/v1/invites')
      .set('Authorization', `Bearer ${tokensA.accessToken}`)
      .send({ email: 'secret@orga.com', role: 'AGENT' })
      .expect(201);

    // Org B lists invites — must return empty array
    const invitesB = await request(app.getHttpServer())
      .get('/v1/invites')
      .set('Authorization', `Bearer ${tokensB.accessToken}`)
      .expect(200);

    expect(invitesB.body).toHaveLength(0);
  });
});
