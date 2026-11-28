import { NextRequest } from 'next/server';
import { forwardFileToApi } from '@/lib/api-proxy';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return forwardFileToApi(`/whatsapp-accounts/${encodeURIComponent(params.id)}/media`, req);
}
