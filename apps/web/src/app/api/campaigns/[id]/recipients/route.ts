import { NextRequest } from 'next/server';
import { forwardToApi } from '@/lib/api-proxy';

export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const qs = req.nextUrl.searchParams.toString();
  return forwardToApi(`/campaigns/${encodeURIComponent(params.id)}/recipients${qs ? `?${qs}` : ''}`, { method: 'GET' });
}
