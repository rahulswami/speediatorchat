import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  return forwardToApi(`/overview${qs ? `?${qs}` : ''}`, { method: 'GET' });
}
