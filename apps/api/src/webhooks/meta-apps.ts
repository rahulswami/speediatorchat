import type { ConfigService } from '@nestjs/config';

/**
 * Meta apps whose webhooks Speediator accepts: our own app, plus apps a client business owns
 * and points at our callback. Until our app has Advanced access, Meta only sends a WABA's
 * customer messages to an app owned by the WABA's own business, so a client may run its own.
 */
export interface MetaApp {
  id?: string;
  secret: string;
}

const CLIENT_APP = /^(\d+):(\S+)$/;

/** Parses WHATSAPP_CLIENT_APPS: "appId:appSecret" pairs separated by commas. */
export function parseClientApps(raw: string | undefined): MetaApp[] | null {
  if (!raw?.trim()) return [];
  const apps: MetaApp[] = [];
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = CLIENT_APP.exec(part);
    if (!m) return null;
    apps.push({ id: m[1], secret: m[2] });
  }
  return apps;
}

export function webhookApps(config: ConfigService): MetaApp[] {
  const own = config.get<string>('WHATSAPP_APP_SECRET');
  return [
    ...(own ? [{ id: config.get<string>('META_APP_ID'), secret: own }] : []),
    ...(parseClientApps(config.get<string>('WHATSAPP_CLIENT_APPS')) ?? []),
  ];
}

/** App IDs whose subscription to a WABA means its webhooks reach Speediator. */
export function webhookAppIds(config: ConfigService): string[] {
  const own = config.get<string>('META_APP_ID');
  const clients = (parseClientApps(config.get<string>('WHATSAPP_CLIENT_APPS')) ?? []).map((a) => a.id!);
  return [...(own ? [own] : []), ...clients];
}
