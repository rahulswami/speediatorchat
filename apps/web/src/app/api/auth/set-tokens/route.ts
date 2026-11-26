import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

export async function POST(req: NextRequest) {
  const { accessToken, refreshToken } = await req.json();
  const res = NextResponse.json({ ok: true });
  setAuthCookies(res, { accessToken, refreshToken });
  return res;
}
