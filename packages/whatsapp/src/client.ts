import {
  SendTextMessageParams,
  SendTemplateMessageParams,
  WhatsAppApiResponse,
  CreateTemplateParams,
  MetaTemplateApiResponse,
  PhoneNumberDetails,
  SmbAppDataSyncType,
} from './types';

const DEFAULT_API_VERSION = 'v20.0';
const BASE_URL = 'https://graph.facebook.com';
const PHONE_NUMBER_FIELDS = 'id,display_phone_number,verified_name,is_on_biz_app,platform_type';

const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 32000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return ms * (0.75 + Math.random() * 0.5);
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);

    if (res.ok) return res;

    // Respect Retry-After if present
    const retryAfter = res.headers.get('Retry-After');
    if (retryAfter) {
      await sleep(parseInt(retryAfter, 10) * 1000);
      continue;
    }

    // Don't retry on 4xx (except 429 rate limit)
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      const body = await res.json().catch(() => ({}));
      throw new WhatsAppApiError(res.status, body);
    }

    if (attempt < MAX_RETRIES) {
      await sleep(jitter(Math.min(delay, MAX_DELAY_MS)));
      delay *= 2;
    } else {
      const body = await res.json().catch(() => ({}));
      throw new WhatsAppApiError(res.status, body);
    }
  }

  throw new Error('Unreachable');
}

export class WhatsAppApiError extends Error {
  constructor(
    public status: number,
    public body: object,
  ) {
    super(`WhatsApp API error ${status}: ${JSON.stringify(body)}`);
    this.name = 'WhatsAppApiError';
  }
}

export class WhatsAppClient {
  private readonly apiVersion: string;
  private readonly baseUrl: string;

  constructor(apiVersion?: string) {
    this.apiVersion = apiVersion ?? process.env.WHATSAPP_API_VERSION ?? DEFAULT_API_VERSION;
    this.baseUrl = `${BASE_URL}/${this.apiVersion}`;
  }

  async sendText(params: SendTextMessageParams): Promise<WhatsAppApiResponse> {
    const { phoneNumberId, accessToken, to, body, previewUrl = false } = params;
    const res = await fetchWithRetry(
      `${this.baseUrl}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body, preview_url: previewUrl },
        }),
      },
    );
    return res.json();
  }

  async sendTemplate(params: SendTemplateMessageParams): Promise<WhatsAppApiResponse> {
    const { phoneNumberId, accessToken, to, templateName, languageCode, components } = params;
    const res = await fetchWithRetry(
      `${this.baseUrl}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components: components ?? [],
          },
        }),
      },
    );
    return res.json();
  }

  async createTemplate(params: CreateTemplateParams): Promise<MetaTemplateApiResponse> {
    const { wabaId, accessToken, name, language, category, components } = params;
    const res = await fetchWithRetry(
      `${this.baseUrl}/${wabaId}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, language, category, components }),
      },
    );
    return res.json();
  }

  async listTemplates(wabaId: string, accessToken: string): Promise<{ data: object[] }> {
    const res = await fetchWithRetry(
      `${this.baseUrl}/${wabaId}/message_templates?fields=name,language,category,status,components,rejected_reason`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return res.json();
  }
}

export interface ExchangeCodeParams {
  code: string;
  appId: string;
  appSecret: string;
}

export class WhatsAppOnboardingClient {
  private readonly baseUrl: string;

  constructor(apiVersion?: string) {
    const version = apiVersion ?? process.env.WHATSAPP_API_VERSION ?? DEFAULT_API_VERSION;
    this.baseUrl = `${BASE_URL}/${version}`;
  }

  /**
   * Trades the one-time code from Embedded Signup (valid ~5 minutes, single use) for the
   * customer's business token. The app secret travels only in this server-to-server call.
   */
  async exchangeCodeForToken({ code, appId, appSecret }: ExchangeCodeParams): Promise<string> {
    const qs = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    // No retries: the code is single use, so a retried request after a lost response fails anyway.
    const res = await fetch(`${this.baseUrl}/oauth/access_token?${qs}`);
    const body = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!res.ok || !body.access_token) throw new WhatsAppApiError(res.status, redactToken(body));
    return body.access_token;
  }

  async getPhoneNumber(phoneNumberId: string, accessToken: string): Promise<PhoneNumberDetails> {
    const res = await fetchWithRetry(`${this.baseUrl}/${phoneNumberId}?fields=${PHONE_NUMBER_FIELDS}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.json();
  }

  async listPhoneNumbers(wabaId: string, accessToken: string): Promise<PhoneNumberDetails[]> {
    const res = await fetchWithRetry(`${this.baseUrl}/${wabaId}/phone_numbers?fields=${PHONE_NUMBER_FIELDS}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json()) as { data?: PhoneNumberDetails[] };
    return body.data ?? [];
  }

  /** Without this, Meta does not deliver the customer's webhooks to our callback. */
  async subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
    await fetchWithRetry(`${this.baseUrl}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  /** `pin` becomes the number's two-step verification PIN. */
  async registerPhoneNumber(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
    await fetchWithRetry(`${this.baseUrl}/${phoneNumberId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
  }

  /**
   * Coexistence only. Meta allows each sync once per onboarding, within 24 hours of it.
   * The data itself arrives later on the `smb_app_state_sync` and `history` webhooks.
   */
  async requestSmbAppDataSync(
    phoneNumberId: string,
    accessToken: string,
    syncType: SmbAppDataSyncType,
  ): Promise<{ request_id?: string }> {
    const res = await fetchWithRetry(`${this.baseUrl}/${phoneNumberId}/smb_app_data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
    });
    return res.json();
  }
}

function redactToken(body: object): object {
  return 'access_token' in body ? { ...body, access_token: '[redacted]' } : body;
}

export const whatsAppClient = new WhatsAppClient();
export const whatsAppOnboardingClient = new WhatsAppOnboardingClient();
