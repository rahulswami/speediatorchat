import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return forwardToApi(`/conversations/${encodeURIComponent(params.id)}/messages/template`, {
    method: 'POST',
    body: await req.json(),
  });
}
