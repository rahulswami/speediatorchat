import { forwardToApi } from '@/lib/api-proxy';

export function GET() {
  return forwardToApi('/contacts/tags', { method: 'GET' });
}
