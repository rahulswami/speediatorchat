import { encryptToken, WhatsAppApiError } from '@speediator/whatsapp';
import { ConnectionCheckService } from './connection-check.service';

const KEY = '0'.repeat(64);

describe('ConnectionCheckService', () => {
  const token = encryptToken('TOKEN', KEY);
  const account = { id: 'acc', organizationId: 'org', phoneNumberId: 'PN', wabaId: 'WABA', ...token };
  const env: Record<string, string> = { WHATSAPP_TOKEN_ENCRYPTION_KEY: KEY, META_APP_ID: '123' };

  function service(meta: object, lastWebhook: Date | null = new Date('2026-11-27T10:00:00Z')) {
    const prisma = {
      whatsappAccount: { findFirst: jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
        where.id === 'acc' && where.organizationId === 'org' ? account : null) },
      webhookEvent: { findFirst: jest.fn(async () => (lastWebhook ? { createdAt: lastWebhook } : null)) },
    };
    return new ConnectionCheckService(prisma as never, { get: (k: string) => env[k] } as never, meta as never);
  }

  it('reports a working number', async () => {
    const result = await service({
      getPhoneNumber: async () => ({ id: 'PN', verified_name: 'Acme', display_phone_number: '+91 98765 43210' }),
      listSubscribedApps: async () => [{ id: '123', name: 'Speediator' }],
    }).check('org', 'acc');

    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => [c.key, c.ok])).toEqual([['token', true], ['webhooks', true], ['lastWebhook', true]]);
    expect(result.checks[0].detail).toBe('Acme · +91 98765 43210');
    expect(result.checks[2].at).toBe('2026-11-27T10:00:00.000Z');
  });

  it('explains an expired token and a missing webhook subscription', async () => {
    const expired = new WhatsAppApiError(401, { error: { code: 190, message: 'Session has expired' } });
    const result = await service(
      { getPhoneNumber: async () => { throw expired; }, listSubscribedApps: async () => [{ id: '999', name: 'Other app' }] },
      null,
    ).check('org', 'acc');

    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ ok: false, detail: expect.stringContaining('Connect the number again') });
    expect(result.checks[1]).toMatchObject({ ok: false, detail: expect.stringContaining('not subscribed') });
    expect(result.checks[2]).toMatchObject({ ok: false });
  });

  it("refuses to check another organization's number", async () => {
    await expect(service({}).check('other-org', 'acc')).rejects.toThrow('Account not found');
  });
});
