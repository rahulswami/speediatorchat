import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.redirect(
    new URL('/login', process.env.APP_URL ?? 'http://localhost:3000'),
  );
  res.cookies.delete('access_token');
  res.cookies.delete('refresh_token');
  return res;
}
