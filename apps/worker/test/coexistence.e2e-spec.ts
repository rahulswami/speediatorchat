import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { PrismaService } from '../src/prisma/prisma.service';
import { ContactsService } from '../src/contacts/contacts.service';
import { ConversationsService } from '../src/conversations/conversations.service';
import { CoexistenceService } from '../src/coexistence/coexistence.service';
import { WebhookEventsConsumer } from '../src/consumers/webhook-events.consumer';

// Runs the real consumer against the test database, with payloads shaped like Meta's
// webhook reference examples.
const BUSINESS = '15550783881';
const CUSTOMER = '16505551234';
const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('Coexistence mirroring (e2e)', () => {
  const prisma = new PrismaService();
  const conversations = new ConversationsService(prisma);
  const events = new EventEmitter2();
  const consumer = new WebhookEventsConsumer(
    prisma,
    new ContactsService(prisma),
    conversations,
    events,
    new CoexistenceService(prisma, conversations, events),
  );

  let orgA: { id: string };
  let orgB: { id: string };
  let accountA: { id: string };

  async function deliver(organizationId: string, whatsappAccountId: string, field: string, value: object) {
    const event = await prisma.webhookEvent.create({
      data: {
        organizationId,
        whatsappAccountId,
        status: 'PENDING',
        payload: { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field, value }] }] },
      },
    });
    await consumer.process({ data: { eventId: event.id } } as Job<{ eventId: string }>);
  }

  const metadata = { display_phone_number: BUSINESS, phone_number_id: 'PN_A' };

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.whatsappAccount.deleteMany();
    await prisma.organization.deleteMany();

    orgA = await prisma.organization.create({ data: { name: 'A', slug: 'coex-a' } });
    orgB = await prisma.organization.create({ data: { name: 'B', slug: 'coex-b' } });
    const base = { wabaId: 'WABA', displayName: 'Shop', encryptedToken: 'x', iv: 'x', authTag: 'x', isOnBizApp: true };
    accountA = await prisma.whatsappAccount.create({ data: { ...base, organizationId: orgA.id, phoneNumberId: 'PN_A' } });
    await prisma.whatsappAccount.create({ data: { ...base, organizationId: orgB.id, phoneNumberId: 'PN_B' } });
  });

  it('adds address-book contacts without opting them in, and only for that organization', async () => {
    await prisma.contact.create({ data: { organizationId: orgB.id, phone: CUSTOMER, name: 'B keeps this' } });

    await deliver(orgA.id, accountA.id, 'smb_app_state_sync', {
      metadata,
      state_sync: [
        { type: 'contact', contact: { full_name: 'Pablo Morales', phone_number: CUSTOMER }, action: 'add' },
        { type: 'contact', contact: { phone_number: '19995550000' }, action: 'remove' },
      ],
    });

    const a = await prisma.contact.findMany({ where: { organizationId: orgA.id } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ phone: CUSTOMER, name: 'Pablo Morales', optedIn: false });
    const b = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgB.id } });
    expect(b.name).toBe('B keeps this');
  });

  it('mirrors a message sent from the Business app as outbound, then applies edit and delete', async () => {
    const sentAt = nowSeconds() - 60;
    const echo = (m: object) => deliver(orgA.id, accountA.id, 'smb_message_echoes', { metadata, message_echoes: [m] });

    await echo({ from: BUSINESS, to: CUSTOMER, id: 'wamid.E1', timestamp: String(sentAt), type: 'text', text: { body: 'Hi' } });
    let msg = await prisma.message.findUniqueOrThrow({ where: { metaMessageId: 'wamid.E1' }, include: { conversation: true } });
    expect(msg).toMatchObject({ direction: 'OUTBOUND', source: 'BUSINESS_APP', content: { body: 'Hi' } });
    expect(msg.createdAt.getTime()).toBe(sentAt * 1000);
    // A business message never opens the customer-service window.
    expect(msg.conversation.sessionExpiresAt).toBeNull();

    await echo({ from: BUSINESS, to: CUSTOMER, id: 'wamid.E2', timestamp: String(sentAt + 5), type: 'edit', edit: { original_message_id: 'wamid.E1', message: { type: 'text', text: { body: 'Hi there' } } } });
    msg = await prisma.message.findUniqueOrThrow({ where: { metaMessageId: 'wamid.E1' }, include: { conversation: true } });
    expect(msg.content).toEqual({ body: 'Hi there' });

    await echo({ from: BUSINESS, to: CUSTOMER, id: 'wamid.E3', timestamp: String(sentAt + 9), type: 'revoke', revoke: { original_message_id: 'wamid.E1' } });
    msg = await prisma.message.findUniqueOrThrow({ where: { metaMessageId: 'wamid.E1' }, include: { conversation: true } });
    expect(msg.type).toBe('revoked');

    // Re-delivery of the same echo is ignored.
    await echo({ from: BUSINESS, to: CUSTOMER, id: 'wamid.E1', timestamp: String(sentAt), type: 'text', text: { body: 'Hi' } });
    expect(await prisma.message.count()).toBe(1);
  });

  it('imports history into one conversation with real times, without reopening an old window', async () => {
    const old = nowSeconds() - 30 * 24 * 3600;
    const history = (chunkOrder: number, progress: number, messages: object[]) => ({
      metadata,
      history: [{ metadata: { phase: 1, chunk_order: chunkOrder, progress }, threads: [{ id: CUSTOMER, context: { wa_id: CUSTOMER }, messages }] }],
    });

    await deliver(orgA.id, accountA.id, 'history', history(2, 80, [
      { from: CUSTOMER, from_user_id: 'US.1', id: 'wamid.H2', timestamp: String(old + 60), type: 'media_placeholder', history_context: { status: 'READ' } },
    ]));
    await deliver(orgA.id, accountA.id, 'history', history(1, 40, [
      { from: BUSINESS, id: 'wamid.H1', timestamp: String(old), type: 'text', text: { body: 'Order shipped' }, history_context: { status: 'read' } },
    ]));

    const conversationsA = await prisma.conversation.findMany({ where: { organizationId: orgA.id } });
    expect(conversationsA).toHaveLength(1);
    expect(conversationsA[0]).toMatchObject({ status: 'RESOLVED', sessionExpiresAt: null });

    const messages = await prisma.message.findMany({ orderBy: { createdAt: 'asc' } });
    expect(messages.map((m) => [m.metaMessageId, m.direction, m.source, m.status])).toEqual([
      ['wamid.H1', 'OUTBOUND', 'HISTORY', 'READ'],
      ['wamid.H2', 'INBOUND', 'HISTORY', 'READ'],
    ]);

    const account = await prisma.whatsappAccount.findUniqueOrThrow({ where: { id: accountA.id } });
    expect(account.historySyncProgress).toBe(80);

    // The media for a history placeholder arrives later on the normal messages webhook.
    await deliver(orgA.id, accountA.id, 'messages', {
      metadata,
      messages: [{ from: CUSTOMER, from_user_id: 'US.1', id: 'wamid.H2', timestamp: String(old + 60), type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }],
    });
    const filled = await prisma.message.findUniqueOrThrow({ where: { metaMessageId: 'wamid.H2' } });
    expect(filled).toMatchObject({ type: 'image', content: { id: 'media-1', mime_type: 'image/jpeg' } });
    expect((await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgA.id } })).sessionExpiresAt).toBeNull();
  });

  it('opens the reply window when history holds a customer message from the last 24 hours', async () => {
    const recent = nowSeconds() - 3600;
    await deliver(orgA.id, accountA.id, 'history', {
      metadata,
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: CUSTOMER, messages: [
        { from: CUSTOMER, from_user_id: 'US.1', id: 'wamid.R1', timestamp: String(recent), type: 'text', text: { body: 'Is it in stock?' } },
      ] }] }],
    });

    const conversation = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgA.id } });
    expect(conversation.status).toBe('OPEN');
    expect(conversation.sessionExpiresAt?.getTime()).toBe((recent + 24 * 3600) * 1000);
  });

  it('records that the business turned history sharing off', async () => {
    await deliver(orgA.id, accountA.id, 'history', { metadata, history: [{ errors: [{ code: 2593109 }] }] });

    const account = await prisma.whatsappAccount.findUniqueOrThrow({ where: { id: accountA.id } });
    expect(account.historySyncDeclinedAt).toBeTruthy();
    expect(await prisma.message.count()).toBe(0);
  });

  it('ignores business-sent media on the messages webhook instead of creating a contact for the business', async () => {
    await deliver(orgA.id, accountA.id, 'messages', {
      metadata,
      messages: [{ from: BUSINESS, id: 'wamid.BIZ', timestamp: String(nowSeconds()), type: 'image', image: { id: 'm' } }],
    });

    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
  });

  it('continues the imported conversation when the customer writes again', async () => {
    await deliver(orgA.id, accountA.id, 'history', {
      metadata,
      history: [{ metadata: { phase: 1, chunk_order: 1, progress: 100 }, threads: [{ id: CUSTOMER, messages: [
        { from: BUSINESS, id: 'wamid.OLD', timestamp: String(nowSeconds() - 10 * 24 * 3600), type: 'text', text: { body: 'Thanks for your order' } },
      ] }] }],
    });

    await deliver(orgA.id, accountA.id, 'messages', {
      metadata,
      contacts: [{ profile: { name: 'Pablo' } }],
      messages: [{ from: CUSTOMER, id: 'wamid.NEW', timestamp: String(nowSeconds()), type: 'text', text: { body: 'Hello again' } }],
    });

    const conversationsA = await prisma.conversation.findMany({ where: { organizationId: orgA.id } });
    expect(conversationsA).toHaveLength(1);
    expect(conversationsA[0].status).toBe('OPEN');
    expect(conversationsA[0].sessionExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.message.count({ where: { conversationId: conversationsA[0].id } })).toBe(2);
  });
});
