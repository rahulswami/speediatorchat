import {
  contactChanges,
  isFromBusiness,
  mapHistoryStatus,
  parseEchoes,
  parseHistory,
  type HistoryValue,
} from './coexistence-payloads';

// Examples below are Meta's reference payloads (webhooks reference, 2026-11), trimmed.
const metadata = { display_phone_number: '15550783881', phone_number_id: '106540352242922' };

describe('contactChanges', () => {
  it('reads added contacts and skips ones without a phone number', () => {
    expect(
      contactChanges({
        metadata,
        state_sync: [
          {
            type: 'contact',
            contact: { full_name: 'Pablo Morales', first_name: 'Pablo', phone_number: '16505551234' },
            action: 'add',
          },
          { type: 'contact', contact: { full_name: 'No Phone' }, action: 'add' },
          { type: 'contact', contact: { phone_number: '+1 650 555 0000' }, action: 'remove' },
        ],
      }),
    ).toEqual([
      { phone: '16505551234', name: 'Pablo Morales', action: 'add' },
      { phone: '16505550000', name: undefined, action: 'remove' },
    ]);
  });
});

describe('isFromBusiness', () => {
  it('treats from_user_id as the customer and the business number as the business', () => {
    expect(isFromBusiness({ from: '15550783881' }, '+1 555-078-3881')).toBe(true);
    expect(isFromBusiness({ from: '16505551234', from_user_id: 'US.1' }, '15550783881')).toBe(false);
    expect(isFromBusiness({ from: '15550783881' }, undefined)).toBe(false);
  });
});

describe('mapHistoryStatus', () => {
  it('accepts both casings Meta documents', () => {
    expect(mapHistoryStatus('READ')).toBe('READ');
    expect(mapHistoryStatus('played')).toBe('READ');
    expect(mapHistoryStatus('delivered')).toBe('DELIVERED');
    expect(mapHistoryStatus('ERROR')).toBe('FAILED');
    expect(mapHistoryStatus(undefined)).toBe('SENT');
  });
});

describe('parseHistory', () => {
  const thread = (id: string, messages: object[]) => ({ id, context: { wa_id: id }, messages });

  it('splits business and customer messages and keeps their real time', () => {
    const batch = parseHistory({
      metadata,
      history: [
        {
          metadata: { phase: 0, chunk_order: 1, progress: 55 },
          threads: [
            thread('16505551234', [
              { from: '15550783881', id: 'wamid.B', timestamp: '1739230955', type: 'text', text: { body: 'Info' }, history_context: { status: 'READ' } },
              { from: '16505551234', from_user_id: 'US.1', id: 'wamid.C', timestamp: '1739230970', type: 'text', text: { body: 'Thanks!' }, history_context: { status: 'READ' } },
            ]),
          ],
        },
      ],
    } as HistoryValue);

    expect(batch).toMatchObject({ declined: false, progress: 55 });
    expect(batch.threads).toHaveLength(1);
    expect(batch.threads[0].phone).toBe('16505551234');
    expect(batch.threads[0].messages).toEqual([
      { metaMessageId: 'wamid.B', direction: 'OUTBOUND', type: 'text', content: { body: 'Info' }, status: 'READ', at: new Date(1739230955000) },
      { metaMessageId: 'wamid.C', direction: 'INBOUND', type: 'text', content: { body: 'Thanks!' }, status: 'READ', at: new Date(1739230970000) },
    ]);
  });

  it('merges a customer split across out-of-order chunks and sorts by time', () => {
    const batch = parseHistory({
      metadata,
      history: [
        { metadata: { phase: 1, chunk_order: 2, progress: 90 }, threads: [thread('911', [{ from: '911', from_user_id: 'u', id: 'm3', timestamp: '30', type: 'text', text: { body: 'c' } }])] },
        { metadata: { phase: 1, chunk_order: 1, progress: 40 }, threads: [thread('911', [{ from: '911', from_user_id: 'u', id: 'm1', timestamp: '10', type: 'media_placeholder' }])] },
      ],
    } as HistoryValue);

    expect(batch.progress).toBe(90);
    expect(batch.threads).toHaveLength(1);
    expect(batch.threads[0].messages.map((m) => [m.metaMessageId, m.type, m.content])).toEqual([
      ['m1', 'media_placeholder', { placeholder: true }],
      ['m3', 'text', { body: 'c' }],
    ]);
  });

  it('recognises that the business turned history sharing off', () => {
    const batch = parseHistory({
      metadata,
      history: [{ errors: [{ code: 2593109 }] }],
    } as HistoryValue);
    expect(batch).toEqual({ declined: true, progress: undefined, threads: [] });
  });
});

describe('parseEchoes', () => {
  it('reads sent messages, edits and deletions from the Business app', () => {
    expect(
      parseEchoes({
        metadata,
        message_echoes: [
          { from: '15550783881', to: '16505551234', id: 'wamid.E', timestamp: '1739321024', type: 'text', text: { body: 'Hi' } },
          { from: '15550783881', to: '16505551234', id: 'wamid.F', timestamp: '1739321030', type: 'edit', edit: { original_message_id: 'wamid.E', message: { id: 'x', type: 'text', text: { body: 'Hi there' } } } },
          { from: '15550783881', to: '16505551234', id: 'wamid.G', timestamp: '1739321040', type: 'revoke', revoke: { original_message_id: 'wamid.E' } },
          { from: '15550783881', id: 'wamid.H', timestamp: '1', type: 'text', text: { body: 'no recipient' } },
        ],
      }),
    ).toEqual([
      { kind: 'message', phone: '16505551234', message: { metaMessageId: 'wamid.E', type: 'text', content: { body: 'Hi' }, at: new Date(1739321024000) } },
      { kind: 'edit', originalId: 'wamid.E', type: 'text', content: { body: 'Hi there' } },
      { kind: 'revoke', originalId: 'wamid.E' },
    ]);
  });
});
