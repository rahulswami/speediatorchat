import { WebhooksService } from './webhooks.service';

describe('WebhooksService.handleIncoming', () => {
  const accounts = [
    { id: 'acc-a', organizationId: 'org-a', phoneNumberId: 'PN_A', wabaId: 'WABA_A' },
    { id: 'acc-b', organizationId: 'org-b', phoneNumberId: 'PN_B', wabaId: 'WABA_B' },
  ];
  let created: Array<{ organizationId: string; whatsappAccountId: string; payload: any }>;
  let queued: string[];
  let service: WebhooksService;

  beforeEach(() => {
    created = [];
    queued = [];
    const prisma = {
      whatsappAccount: {
        findFirst: jest.fn(async ({ where }: { where: { phoneNumberId?: string; wabaId?: string } }) => {
          const a = accounts.find((x) =>
            where.phoneNumberId ? x.phoneNumberId === where.phoneNumberId : x.wabaId === where.wabaId,
          );
          return a ? { id: a.id, organizationId: a.organizationId } : null;
        }),
      },
      webhookEvent: {
        create: jest.fn(async ({ data }: { data: (typeof created)[number] }) => {
          created.push(data);
          return { id: `evt-${created.length}` };
        }),
      },
    };
    const queue = { add: jest.fn(async (_name: string, data: { eventId: string }) => { queued.push(data.eventId); }) };
    service = new WebhooksService(prisma as never, queue as never);
  });

  const messageChange = (phoneNumberId: string, wamid: string) => ({
    field: 'messages',
    value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: wamid }] },
  });

  it('stores each change of a batched delivery as its own event for the right organization', async () => {
    await service.handleIncoming({
      object: 'whatsapp_business_account',
      entry: [
        { id: 'WABA_A', changes: [messageChange('PN_A', 'wamid.1'), messageChange('PN_A', 'wamid.2')] },
        { id: 'WABA_B', changes: [messageChange('PN_B', 'wamid.3')] },
      ],
    });

    expect(created.map((e) => [e.organizationId, e.whatsappAccountId])).toEqual([
      ['org-a', 'acc-a'],
      ['org-a', 'acc-a'],
      ['org-b', 'acc-b'],
    ]);
    expect(created.map((e) => e.payload.entry[0].changes[0].value.messages[0].id)).toEqual([
      'wamid.1',
      'wamid.2',
      'wamid.3',
    ]);
    expect(created.every((e) => e.payload.entry[0].changes.length === 1)).toBe(true);
    expect(queued).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });

  it('routes account_update by waba_info.waba_id, not entry.id', async () => {
    await service.handleIncoming({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'PARTNER_BUSINESS_ID',
          changes: [
            { field: 'account_update', value: { event: 'PARTNER_APP_UNINSTALLED', waba_info: { waba_id: 'WABA_B' } } },
          ],
        },
      ],
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ organizationId: 'org-b', whatsappAccountId: 'acc-b' });
  });

  it('accepts the unwrapped history-declined payload from Meta\'s reference', async () => {
    await service.handleIncoming({
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550783881', phone_number_id: 'PN_A' },
      history: [{ errors: [{ code: 2593109, title: 'History sync is turned off by the business' }] }],
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ organizationId: 'org-a', whatsappAccountId: 'acc-a' });
    expect(created[0].payload.entry[0].changes[0]).toMatchObject({
      field: 'history',
      value: { history: [{ errors: [{ code: 2593109 }] }] },
    });
  });

  it('drops changes for numbers no organization has connected', async () => {
    await service.handleIncoming({
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA_X', changes: [messageChange('PN_UNKNOWN', 'wamid.9')] }],
    });

    expect(created).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });
});
