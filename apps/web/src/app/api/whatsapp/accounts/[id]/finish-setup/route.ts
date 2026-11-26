import { forwardToApi } from '@/lib/api-proxy';

export function POST(_req: Request, { params }: { params: { id: string } }) {
  return forwardToApi(`/whatsapp-accounts/${encodeURIComponent(params.id)}/finish-setup`, { method: 'POST' });
}
