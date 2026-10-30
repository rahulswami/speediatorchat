import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  const [ownerAcme, agentAcme, ownerBeta] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'owner@acme.com' },
      update: {},
      create: { email: 'owner@acme.com', name: 'Acme Owner', passwordHash: await hash('password123') },
    }),
    prisma.user.upsert({
      where: { email: 'agent@acme.com' },
      update: {},
      create: { email: 'agent@acme.com', name: 'Acme Agent', passwordHash: await hash('password123') },
    }),
    prisma.user.upsert({
      where: { email: 'owner@beta.com' },
      update: {},
      create: { email: 'owner@beta.com', name: 'Beta Owner', passwordHash: await hash('password123') },
    }),
  ]);

  const acme = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { slug: 'acme', name: 'Acme D2C', timezone: 'Asia/Kolkata' },
  });

  const beta = await prisma.organization.upsert({
    where: { slug: 'beta' },
    update: {},
    create: { slug: 'beta', name: 'Beta Salon', timezone: 'Asia/Kolkata' },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: acme.id, userId: ownerAcme.id } },
    update: {},
    create: { organizationId: acme.id, userId: ownerAcme.id, role: Role.OWNER },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: acme.id, userId: agentAcme.id } },
    update: {},
    create: { organizationId: acme.id, userId: agentAcme.id, role: Role.AGENT },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: beta.id, userId: ownerBeta.id } },
    update: {},
    create: { organizationId: beta.id, userId: ownerBeta.id, role: Role.OWNER },
  });

  console.log('Seeded: Acme D2C (owner@acme.com, agent@acme.com) and Beta Salon (owner@beta.com) — password: password123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
