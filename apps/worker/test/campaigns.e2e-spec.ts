import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job, Queue } from 'bullmq';
import { WhatsAppClient } from '@speediator/whatsapp';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContactsService } from '../src/contacts/contacts.service';
import { ConversationsService } from '../src/conversations/conversations.service';
import { CoexistenceService } from '../src/coexistence/coexistence.service';
import { WebhookEventsConsumer } from '../src/consumers/webhook-events.consumer';
import { CampaignFanOutConsumer } from '../src/consumers/campaign-fanout.consumer';
import { CampaignSendConsumer } from '../src/consumers/campaign-send.consumer';
import { encryptToken } from '@speediator/whatsapp';

describe('Campaign sending and delivery tracking (e2e)', () => {
  const prisma = new PrismaService();
  const conversations = new ConversationsService(prisma);
  const events = new EventEmitter2();
  const config = { get: (k: string) => process.env[k] } as never;
  const queued: Array<{ campaignId: string; contactId: string; organizationId: string }> = [];
  const fanout = new CampaignFanOutConsumer(prisma, { add: async (_n: string, d: never) => { queued.push(d); } } as unknown as Queue);
  const sender = new CampaignSendConsumer(prisma, config, conversations);
  const webhooks = new WebhookEventsConsumer(prisma, new ContactsService(prisma), conversations, events, new CoexistenceService(prisma, conversations, events));

  let orgId: string;
  let accountId: string;
  let templateId: string;

  async function makeCampaign(audienceFilter: object = { mode: 'all' }) {
    const user = await prisma.user.findFirstOrThrow();
    return prisma.campaign.create({
      data: { organizationId: orgId, whatsappAccountId: accountId, templateId, createdBy: user.id, name: 'C', status: 'RUNNING', audienceFilter },
    });
  }

  async function status(id: string, value: string, timestamp: number) {
    const event = await prisma.webhookEvent.create({
      data: {
        organizationId: orgId, whatsappAccountId: accountId, status: 'PENDING',
        payload: { entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id, status: value, timestamp: String(timestamp) }] } }] }] },
      },
    });
    await webhooks.process({ data: { eventId: event.id } } as Job<{ eventId: string }>);
  }

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    queued.length = 0;
    jest.restoreAllMocks();
    await prisma.webhookEvent.deleteMany();
    await prisma.campaignContact.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.template.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    const org = await prisma.organization.create({ data: { name: 'Org', slug: 'camp-worker' } });
    orgId = org.id;
    await prisma.user.create({ data: { email: 'o@camp.test', name: 'O', passwordHash: 'x' } });
    const token = encryptToken('TOKEN', process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY!);
    accountId = (await prisma.whatsappAccount.create({
      data: { organizationId: orgId, wabaId: 'W', phoneNumberId: 'PN', displayName: 'Shop', ...token },
    })).id;
    templateId = (await prisma.template.create({
      data: { organizationId: orgId, whatsappAccountId: accountId, name: 'hello_test', language: 'en', category: 'MARKETING', status: 'APPROVED', components: [] },
    })).id;
  });

  it('completes straight away when no opted-in contact matches', async () => {
    await prisma.contact.create({ data: { organizationId: orgId, phone: '911', optedIn: false } });
    const campaign = await makeCampaign();

    await fanout.process({ data: { campaignId: campaign.id, organizationId: orgId } } as Job<{ campaignId: string; organizationId: string }>);

    expect(queued).toHaveLength(0);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('COMPLETED');
  });

  it('records the wamid, shows the message in the inbox, and tracks delivery in order', async () => {
    jest.spyOn(WhatsAppClient.prototype, 'sendTemplate').mockResolvedValue({ messages: [{ id: 'wamid.C1' }] });
    const contact = await prisma.contact.create({ data: { organizationId: orgId, phone: '911', optedIn: true } });
    const campaign = await makeCampaign();
    await fanout.process({ data: { campaignId: campaign.id, organizationId: orgId } } as Job<{ campaignId: string; organizationId: string }>);
    await sender.process({ data: queued[0] } as Job<(typeof queued)[number]>);

    let recipient = await prisma.campaignContact.findFirstOrThrow({ where: { campaignId: campaign.id, contactId: contact.id } });
    expect(recipient).toMatchObject({ status: 'SENT', metaMessageId: 'wamid.C1' });
    const inbox = await prisma.message.findUniqueOrThrow({ where: { metaMessageId: 'wamid.C1' } });
    expect(inbox).toMatchObject({ direction: 'OUTBOUND', type: 'template', content: { templateName: 'hello_test' } });

    // "read" arrives before "delivered": the later "delivered" must not move it backwards.
    await status('wamid.C1', 'read', 1_800_000_100);
    await status('wamid.C1', 'delivered', 1_800_000_050);
    recipient = await prisma.campaignContact.findFirstOrThrow({ where: { id: recipient.id } });
    expect(recipient.status).toBe('READ');
    expect(recipient.readAt?.getTime()).toBe(1_800_000_100_000);
    expect((await prisma.message.findUniqueOrThrow({ where: { metaMessageId: 'wamid.C1' } })).status).toBe('READ');
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('COMPLETED');
  });

  it('fails a recipient instead of sending when the template is no longer approved', async () => {
    const send = jest.spyOn(WhatsAppClient.prototype, 'sendTemplate');
    await prisma.contact.create({ data: { organizationId: orgId, phone: '911', optedIn: true } });
    const campaign = await makeCampaign();
    await fanout.process({ data: { campaignId: campaign.id, organizationId: orgId } } as Job<{ campaignId: string; organizationId: string }>);
    await prisma.template.update({ where: { id: templateId }, data: { status: 'PAUSED' } });

    await sender.process({ data: queued[0] } as Job<(typeof queued)[number]>);

    expect(send).not.toHaveBeenCalled();
    const recipient = await prisma.campaignContact.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(recipient).toMatchObject({ status: 'FAILED', error: expect.stringContaining('paused') });
  });
});
