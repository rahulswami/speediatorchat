import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export async function POST(req: NextRequest) {
  return forwardToApi('/campaigns/audience-preview', { method: 'POST', body: await req.json() });
}
