import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

type Ctx = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return forwardToApi(`/contacts/${encodeURIComponent(params.id)}`, { method: 'PATCH', body: await req.json() });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return forwardToApi(`/contacts/${encodeURIComponent(params.id)}`, { method: 'DELETE' });
}
