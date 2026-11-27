import { forwardToApi } from '@/lib/api-proxy';

export function POST(_req: Request, { params }: { params: { accountId: string } }) {
  return forwardToApi(`/templates/${encodeURIComponent(params.accountId)}/sync`, { method: 'POST' });
}
