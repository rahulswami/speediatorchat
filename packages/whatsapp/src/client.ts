import {
  SendTextMessageParams,
  SendTemplateMessageParams,
  WhatsAppApiResponse,
  CreateTemplateParams,
  MetaTemplateApiResponse,
} from './types';

const DEFAULT_API_VERSION = 'v20.0';
const BASE_URL = 'https://graph.facebook.com';

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

export const whatsAppClient = new WhatsAppClient();
