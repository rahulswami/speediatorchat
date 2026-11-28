import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; tagId: string } }) {
  return forwardToApi(
    `/contacts/${encodeURIComponent(params.id)}/tags/${encodeURIComponent(params.tagId)}`,
    { method: 'DELETE' },
  );
}
