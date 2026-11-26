import { forwardToApi } from '@/lib/api-proxy';

export function GET() {
  return forwardToApi('/whatsapp-accounts/embedded-signup/config', { method: 'GET' });
}
