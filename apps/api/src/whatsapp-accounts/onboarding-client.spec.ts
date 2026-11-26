import { WhatsAppApiError, WhatsAppOnboardingClient } from '@speediator/whatsapp';

type FetchCall = [string, RequestInit | undefined];

function mockFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = queue.shift() ?? { body: {} };
    const status = next.status ?? 200;
    return new Response(JSON.stringify(next.body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return calls;
}

describe('WhatsAppOnboardingClient', () => {
  const client = new WhatsAppOnboardingClient('v27.0');
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('exchanges the signup code for a business token', async () => {
    const calls = mockFetch({ body: { access_token: 'BUSINESS_TOKEN', token_type: 'bearer' } });

    const token = await client.exchangeCodeForToken({ code: 'abc', appId: '123', appSecret: 's3cret' });

    expect(token).toBe('BUSINESS_TOKEN');
    const url = new URL(calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v27.0/oauth/access_token');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: '123', client_secret: 's3cret', code: 'abc' });
  });

  it('does not retry a rejected code and keeps any token out of the error', async () => {
    const calls = mockFetch({ status: 400, body: { error: { message: 'Code expired' }, access_token: 'leak' } });

    const err = await client.exchangeCodeForToken({ code: 'old', appId: '1', appSecret: 's' }).catch((e) => e);

    expect(err).toBeInstanceOf(WhatsAppApiError);
    expect(err.message).toContain('Code expired');
    expect(err.message).not.toContain('leak');
    expect(calls).toHaveLength(1);
  });

  it('subscribes the app to the WABA with the business token', async () => {
    const calls = mockFetch({ body: { success: true } });

    await client.subscribeAppToWaba('555', 'TOKEN');

    expect(calls[0][0]).toBe('https://graph.facebook.com/v27.0/555/subscribed_apps');
    expect(calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer TOKEN' } });
  });

  it('registers the number with the PIN', async () => {
    const calls = mockFetch({ body: { success: true } });

    await client.registerPhoneNumber('777', 'TOKEN', '123456');

    expect(calls[0][0]).toBe('https://graph.facebook.com/v27.0/777/register');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ messaging_product: 'whatsapp', pin: '123456' });
  });

  it('requests a coexistence sync of the given type', async () => {
    const calls = mockFetch({ body: { request_id: 'r1' } });

    const res = await client.requestSmbAppDataSync('777', 'TOKEN', 'history');

    expect(res).toEqual({ request_id: 'r1' });
    expect(calls[0][0]).toBe('https://graph.facebook.com/v27.0/777/smb_app_data');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' });
  });

  it('lists the numbers on a WABA with the fields setup needs', async () => {
    const calls = mockFetch({ body: { data: [{ id: '777', is_on_biz_app: true }] } });

    const numbers = await client.listPhoneNumbers('555', 'TOKEN');

    expect(numbers).toEqual([{ id: '777', is_on_biz_app: true }]);
    expect(calls[0][0]).toContain('/555/phone_numbers?fields=');
    expect(calls[0][0]).toContain('is_on_biz_app');
  });
});
