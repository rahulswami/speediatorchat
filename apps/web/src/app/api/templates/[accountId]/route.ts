import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

// The segment is named for the sync route beside it; here it is a template id.
export async function DELETE(_req: NextRequest, { params }: { params: { accountId: string } }) {
  return forwardToApi(`/templates/${encodeURIComponent(params.accountId)}`, { method: 'DELETE' });
}
