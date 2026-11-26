import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, setAuthCookies, type AuthTokens } from '@/lib/auth-cookies';

const PUBLIC_PATHS = ['/login', '/register', '/invite'];
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

// Renew a little before expiry so the token can't lapse between here and the API call.
const RENEW_BEFORE_SECONDS = 60;

function secondsUntilExpiry(jwt: string): number {
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload)) as { exp?: number };
    return typeof exp === 'number' ? exp - Math.floor(Date.now() / 1000) : 0;
  } catch {
    return 0;
  }
}

async function renewTokens(refreshToken: string): Promise<AuthTokens | null> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const tokens = (await res.json()) as Partial<AuthTokens>;
    return tokens.accessToken && tokens.refreshToken ? (tokens as AuthTokens) : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();

  const isApi = pathname.startsWith('/api/');
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  let renewed: AuthTokens | null = null;
  if (refreshToken && (!accessToken || secondsUntilExpiry(accessToken) < RENEW_BEFORE_SECONDS)) {
    renewed = await renewTokens(refreshToken);
    if (renewed) {
      accessToken = renewed.accessToken;
      // Route handlers read cookies from the request, so hand them the fresh pair too.
      request.cookies.set(ACCESS_COOKIE, renewed.accessToken);
      request.cookies.set(REFRESH_COOKIE, renewed.refreshToken);
    }
  }

  let res: NextResponse;
  if (!accessToken && isApi) {
    res = NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  } else if (!accessToken && !isPublic) {
    res = NextResponse.redirect(new URL('/login', request.url));
  } else if (accessToken && isPublic && !pathname.startsWith('/invite')) {
    res = NextResponse.redirect(new URL('/dashboard', request.url));
  } else {
    res = NextResponse.next({ request: { headers: request.headers } });
  }

  if (renewed) setAuthCookies(res, renewed);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
