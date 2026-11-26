import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export async function POST(req: NextRequest) {
  return forwardToApi('/whatsapp-accounts/embedded-signup', { method: 'POST', body: await req.json() });
}
