import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth-cookies';

export async function POST() {
  // A relative Location keeps the browser on whatever host it used. Behind the proxy the
  // server only sees its internal address, so an absolute URL built here would point there.
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
