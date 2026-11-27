import { whatsAppClient } from '@speediator/whatsapp';
import { MessagesService } from './messages.service';

describe('MessagesService.sendTemplate', () => {
  const baseContact = { phone: '919876543210', optedIn: true, optedOut: false };
  const baseTemplate = { id: 't1', organizationId: 'org', whatsappAccountId: 'acc', name: 'hello_test', language: 'en_US', status: 'APPROVED', category: 'MARKETING' };

  function setup(over: { contact?: object; template?: object; accountStatus?: string } = {}) {
    const created: object[] = [];
    const prisma = {
      conversation: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
          where.organizationId === 'org'
            ? { id: 'c1', whatsappAccountId: 'acc', contact: { ...baseContact, ...over.contact }, whatsappAccount: { status: over.accountStatus ?? 'CONNECTED', phoneNumberId: 'PN' } }
            : null),
        update: jest.fn(),
      },
      template: { findFirst: jest.fn(async () => ({ ...baseTemplate, ...over.template })) },
      message: { create: jest.fn(async ({ data }: { data: object }) => { created.push(data); return data; }) },
    };
    const accounts = { getDecryptedToken: jest.fn(async () => 'TOKEN') };
    const send = jest.spyOn(whatsAppClient, 'sendTemplate').mockResolvedValue({ messages: [{ id: 'wamid.T' }] });
    return { service: new MessagesService(prisma as never, accounts as never), created, send };
  }

  afterEach(() => jest.restoreAllMocks());

  it('sends an approved template and records it in the thread', async () => {
    const { service, created, send } = setup();
    await service.sendTemplate('org', 'c1', 't1');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'hello_test', languageCode: 'en_US', to: '919876543210' }));
    expect(created[0]).toMatchObject({ type: 'template', metaMessageId: 'wamid.T', content: { templateName: 'hello_test' } });
  });

  it('refuses marketing templates to contacts who never opted in, but allows utility ones', async () => {
    const marketing = setup({ contact: { optedIn: false } });
    await expect(marketing.service.sendTemplate('org', 'c1', 't1')).rejects.toThrow('opted in');
    expect(marketing.send).not.toHaveBeenCalled();
    jest.restoreAllMocks();

    const utility = setup({ contact: { optedIn: false }, template: { category: 'UTILITY' } });
    await expect(utility.service.sendTemplate('org', 'c1', 't1')).resolves.toBeDefined();
  });

  it.each([
    ['opted-out contact', { contact: { optedOut: true } }, 'opted out'],
    ['unapproved template', { template: { status: 'PAUSED' } }, 'approved'],
    ['template from another number', { template: { whatsappAccountId: 'other' } }, 'different WhatsApp number'],
    ['disconnected number', { accountStatus: 'DISCONNECTED' }, 'not connected'],
  ])('refuses a %s', async (_name, over, message) => {
    const { service, send } = setup(over);
    await expect(service.sendTemplate('org', 'c1', 't1')).rejects.toThrow(message);
    expect(send).not.toHaveBeenCalled();
  });

  it("can't send into another organization's conversation", async () => {
    const { service } = setup();
    await expect(service.sendTemplate('other-org', 'c1', 't1')).rejects.toThrow('Conversation not found');
  });
});
