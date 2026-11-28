import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return forwardToApi(`/contacts/${encodeURIComponent(params.id)}/tags`, { method: 'POST', body: await req.json() });
}
