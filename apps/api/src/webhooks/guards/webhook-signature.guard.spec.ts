import { ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { parseClientApps } from '../meta-apps';

function contextFor(headers: Record<string, string>, rawBody?: Buffer) {
  const request = { headers, raw: { rawBody } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

function guardWith(env: Record<string, string | undefined>) {
  return new WebhookSignatureGuard({ get: (k: string) => env[k] } as never);
}

describe('WebhookSignatureGuard', () => {
  const body = Buffer.from('{"entry":[]}');
  const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a correctly signed request', () => {
    const guard = guardWith({ WHATSAPP_APP_SECRET: 's3cret', NODE_ENV: 'production' });
    expect(guard.canActivate(contextFor({ 'x-hub-signature-256': sign('s3cret') }, body))).toBe(true);
  });

  it('rejects a wrong signature', () => {
    const guard = guardWith({ WHATSAPP_APP_SECRET: 's3cret', NODE_ENV: 'production' });
    expect(() => guard.canActivate(contextFor({ 'x-hub-signature-256': sign('other') }, body))).toThrow(ForbiddenException);
  });

  it('rejects every webhook in production when the app secret is missing', () => {
    const guard = guardWith({ WHATSAPP_APP_SECRET: undefined, NODE_ENV: 'production' });
    expect(() => guard.canActivate(contextFor({ 'x-hub-signature-256': sign('anything') }, body))).toThrow(ForbiddenException);
  });

  it('still allows unsigned replays in local development without a secret', () => {
    const guard = guardWith({ WHATSAPP_APP_SECRET: undefined, NODE_ENV: 'development' });
    expect(guard.canActivate(contextFor({ 'x-hub-signature-256': 'sha256=x' }, body))).toBe(true);
  });

  it('accepts webhooks from a client-owned Meta app listed in WHATSAPP_CLIENT_APPS', () => {
    const guard = guardWith({ WHATSAPP_APP_SECRET: 'ours', WHATSAPP_CLIENT_APPS: '111:theirs, 222:another', NODE_ENV: 'production' });
    expect(guard.canActivate(contextFor({ 'x-hub-signature-256': sign('theirs') }, body))).toBe(true);
    expect(guard.canActivate(contextFor({ 'x-hub-signature-256': sign('ours') }, body))).toBe(true);
    expect(() => guard.canActivate(contextFor({ 'x-hub-signature-256': sign('stranger') }, body))).toThrow(ForbiddenException);
  });

  it('works with only client apps configured', () => {
    const guard = guardWith({ WHATSAPP_CLIENT_APPS: '111:theirs', NODE_ENV: 'production' });
    expect(guard.canActivate(contextFor({ 'x-hub-signature-256': sign('theirs') }, body))).toBe(true);
  });
});

describe('parseClientApps', () => {
  it('reads appId:secret pairs and rejects anything else', () => {
    expect(parseClientApps('111:abc, 222:def')).toEqual([{ id: '111', secret: 'abc' }, { id: '222', secret: 'def' }]);
    expect(parseClientApps('')).toEqual([]);
    expect(parseClientApps('abc')).toBeNull();
    expect(parseClientApps('111:')).toBeNull();
  });
});
