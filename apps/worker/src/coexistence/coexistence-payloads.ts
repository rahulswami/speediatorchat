// Parsing for the WhatsApp Business app coexistence webhooks (smb_app_state_sync, history,
// smb_message_echoes). Shapes follow Meta's webhook reference pages as of 2026-11.
// Pure functions only: the database work lives in CoexistenceService.

export type MirroredStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WaMessage {
  id: string;
  from?: string;
  from_user_id?: string;
  to?: string;
  timestamp?: string | number;
  type: string;
  text?: { body?: string };
  history_context?: { status?: string };
  [key: string]: unknown;
}

interface ValueMetadata {
  display_phone_number?: string;
  phone_number_id?: string;
}

export interface StateSyncValue {
  metadata?: ValueMetadata;
  state_sync?: Array<{
    type?: string;
    action?: string;
    contact?: { full_name?: string; first_name?: string; phone_number?: string };
  }>;
}

export interface HistoryValue {
  metadata?: ValueMetadata;
  history?: Array<{
    metadata?: { phase?: number; chunk_order?: number; progress?: number };
    threads?: Array<{ id?: string; context?: { wa_id?: string }; messages?: WaMessage[] }>;
    errors?: Array<{ code?: number }>;
  }>;
}

export interface EchoValue {
  metadata?: ValueMetadata;
  message_echoes?: Array<
    WaMessage & {
      revoke?: { original_message_id?: string };
      edit?: { original_message_id?: string; message?: WaMessage };
    }
  >;
}

/** Meta's error when the business turned off history sharing in the app. */
export const HISTORY_SHARING_DECLINED = 2593109;

export const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '');

export function toDate(timestamp: string | number | undefined): Date {
  const seconds = typeof timestamp === 'number' ? timestamp : parseInt(timestamp ?? '', 10);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

export function extractContent(msg: WaMessage): object {
  switch (msg.type) {
    case 'text':
      return { body: msg.text?.body ?? '' };
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'sticker':
    case 'location':
      return (msg[msg.type] as object) ?? {};
    // History sends media as a placeholder; the file may follow later on the messages webhook.
    case 'media_placeholder':
      return { placeholder: true };
    default:
      return { raw: msg };
  }
}

// The reference page shows uppercase statuses, the onboarding guide lowercase.
export function mapHistoryStatus(status: string | undefined): MirroredStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'READ':
    case 'PLAYED':
      return 'READ';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'ERROR':
      return 'FAILED';
    case 'PENDING':
      return 'PENDING';
    default:
      return 'SENT';
  }
}

/** Customer messages carry from_user_id; business messages come from the business number. */
export function isFromBusiness(msg: Pick<WaMessage, 'from' | 'from_user_id'>, businessPhone: string | undefined) {
  if (msg.from_user_id) return false;
  const business = digits(businessPhone);
  return business !== '' && digits(msg.from) === business;
}

export interface ContactChange {
  phone: string;
  name?: string;
  action: 'add' | 'remove';
}

/** Changes without a phone number are dropped: contacts are keyed by phone. */
export function contactChanges(value: StateSyncValue): ContactChange[] {
  return (value.state_sync ?? []).flatMap((item) => {
    const phone = digits(item.contact?.phone_number);
    if (item.type !== 'contact' || !phone) return [];
    const action = item.action === 'remove' ? 'remove' : 'add';
    const name = item.contact?.full_name?.trim() || item.contact?.first_name?.trim() || undefined;
    return [{ phone, name, action }];
  });
}

export interface HistoryMessage {
  metaMessageId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content: object;
  status: MirroredStatus;
  at: Date;
}

export interface HistoryThread {
  phone: string;
  messages: HistoryMessage[];
}

export interface HistoryBatch {
  declined: boolean;
  progress?: number;
  threads: HistoryThread[];
}

export function parseHistory(value: HistoryValue): HistoryBatch {
  const chunks = value.history ?? [];
  const declined = chunks.some((c) => c.errors?.some((e) => e.code === HISTORY_SHARING_DECLINED));
  const progresses = chunks.map((c) => c.metadata?.progress).filter((p): p is number => typeof p === 'number');

  // Chunks can arrive out of order; merge threads by customer so each is written once.
  const byPhone = new Map<string, HistoryMessage[]>();
  const ordered = [...chunks].sort(
    (a, b) =>
      (a.metadata?.phase ?? 0) - (b.metadata?.phase ?? 0) ||
      (a.metadata?.chunk_order ?? 0) - (b.metadata?.chunk_order ?? 0),
  );
  for (const chunk of ordered) {
    for (const thread of chunk.threads ?? []) {
      const phone = digits(thread.id ?? thread.context?.wa_id);
      if (!phone) continue;
      const list = byPhone.get(phone) ?? [];
      for (const msg of thread.messages ?? []) {
        if (!msg.id) continue;
        list.push({
          metaMessageId: msg.id,
          direction: isFromBusiness(msg, value.metadata?.display_phone_number) ? 'OUTBOUND' : 'INBOUND',
          type: msg.type,
          content: extractContent(msg),
          status: mapHistoryStatus(msg.history_context?.status),
          at: toDate(msg.timestamp),
        });
      }
      byPhone.set(phone, list);
    }
  }

  return {
    declined,
    progress: progresses.length ? Math.max(...progresses) : undefined,
    threads: [...byPhone].map(([phone, messages]) => ({
      phone,
      messages: messages.sort((a, b) => a.at.getTime() - b.at.getTime()),
    })),
  };
}

export type EchoAction =
  | { kind: 'message'; phone: string; message: Omit<HistoryMessage, 'direction' | 'status'> }
  | { kind: 'edit'; originalId: string; type: string; content: object }
  | { kind: 'revoke'; originalId: string };

export function parseEchoes(value: EchoValue): EchoAction[] {
  return (value.message_echoes ?? []).flatMap((echo): EchoAction[] => {
    if (echo.type === 'revoke') {
      const originalId = echo.revoke?.original_message_id;
      return originalId ? [{ kind: 'revoke', originalId }] : [];
    }
    if (echo.type === 'edit') {
      const originalId = echo.edit?.original_message_id;
      const edited = echo.edit?.message;
      return originalId && edited
        ? [{ kind: 'edit', originalId, type: edited.type, content: extractContent(edited) }]
        : [];
    }
    const phone = digits(echo.to);
    if (!phone || !echo.id) return [];
    return [
      {
        kind: 'message',
        phone,
        message: { metaMessageId: echo.id, type: echo.type, content: extractContent(echo), at: toDate(echo.timestamp) },
      },
    ];
  });
}
