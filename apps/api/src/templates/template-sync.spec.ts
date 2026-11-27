import { WhatsAppClient } from '@speediator/whatsapp';
import { toTemplateCategory, toTemplateStatus } from './templates.service';

describe('toTemplateStatus', () => {
  it('only treats APPROVED as approved, and never fails on statuses we do not store', () => {
    expect(toTemplateStatus('APPROVED')).toBe('APPROVED');
    expect(toTemplateStatus('REJECTED')).toBe('REJECTED');
    expect(toTemplateStatus('PAUSED')).toBe('PAUSED');
    expect(toTemplateStatus('PENDING_DELETION')).toBe('DISABLED');
    expect(toTemplateStatus('DELETED')).toBe('DISABLED');
    expect(toTemplateStatus('IN_APPEAL')).toBe('PENDING');
    expect(toTemplateStatus('SOMETHING_NEW')).toBe('PENDING');
  });
});

describe('toTemplateCategory', () => {
  it('keeps known categories and treats anything else as marketing', () => {
    expect(toTemplateCategory('UTILITY')).toBe('UTILITY');
    expect(toTemplateCategory('AUTHENTICATION')).toBe('AUTHENTICATION');
    expect(toTemplateCategory('MARKETING')).toBe('MARKETING');
    expect(toTemplateCategory('TRANSACTIONAL')).toBe('MARKETING');
  });
});

describe('WhatsAppClient.listTemplates', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('follows Graph paging until the last page', async () => {
    const urls: string[] = [];
    const pages = [
      { data: [{ name: 'a' }], paging: { next: 'https://graph.facebook.com/v27.0/555/message_templates?after=X' } },
      { data: [{ name: 'hello_test' }], paging: {} },
    ];
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    }) as unknown as typeof fetch;

    const { data } = await new WhatsAppClient('v27.0').listTemplates('555', 'TOKEN');

    expect(data).toEqual([{ name: 'a' }, { name: 'hello_test' }]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('limit=100');
    expect(urls[1]).toBe('https://graph.facebook.com/v27.0/555/message_templates?after=X');
  });

  it('does not follow a next link to another host', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ name: 'a' }], paging: { next: 'https://evil.example/steal' } }), { status: 200 });
    }) as unknown as typeof fetch;

    await new WhatsAppClient('v27.0').listTemplates('555', 'TOKEN');

    expect(calls).toBe(1);
  });
});
