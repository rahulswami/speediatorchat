import { NextRequest } from 'next/server';
import { forwardFileToApi } from '@/lib/api-proxy';

export async function POST(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('whatsappAccountId') ?? '';
  return forwardFileToApi(`/templates/header-sample?whatsappAccountId=${encodeURIComponent(accountId)}`, req);
}
