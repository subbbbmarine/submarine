import { NextResponse, type NextRequest } from 'next/server';

// A wallet's key lives in this page's storage, so scripts may only be the site's own: each page gets a fresh nonce, Next puts
// it on its own scripts, and anything injected without it doesn't run. Token names and pictures come from anyone who launches
// one, and this is what limits the damage if one of them ever gets past React. Only in production: the dev server's hot
// reload evaluates code and wouldn't run under it.
const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
};
const connect = ["'self'", origin(process.env.NEXT_PUBLIC_API_URL), origin(process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8546')].filter(Boolean);

function policy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:", // a token's picture can be anywhere
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = policy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Pages only: not the API proxy, Next's files or static ones, which carry no scripts of their own.
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|icon|.*\.(?:png|jpg|svg|ico|webmanifest)$).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
