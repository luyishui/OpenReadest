import { NextRequest, NextResponse } from 'next/server';

const allowedOrigins = [
  'https://tauri.localhost',
  'http://tauri.localhost',
  'http://localhost:3000',
  'http://localhost:3001',
  'tauri://localhost',
];

const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/');

  if (isApi) {
    const origin = request.headers.get('origin') ?? '';
    const isAllowedOrigin = allowedOrigins.includes(origin);

    if (request.method === 'OPTIONS') {
      const preflightHeaders = new Headers({
        ...corsOptions,
        ...(isAllowedOrigin && { 'Access-Control-Allow-Origin': origin }),
      });

      return new NextResponse(null, {
        status: 200,
        headers: preflightHeaders,
      });
    }

    const response = NextResponse.next();

    if (isAllowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }

    Object.entries(corsOptions).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  }

  // Cross-origin isolation enables SharedArrayBuffer, which the Turso WASM
  // database (statistics.db on web) requires. Set on every document response,
  // not just /api/*: `crossOriginIsolated` is a property of the top-level browsing
  // context, determined by the document's headers. Ported from upstream Readest.
  const response = NextResponse.next();
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // The /s share landing embeds a cross-origin cover image that cannot carry a
  // Cross-Origin-Resource-Policy header; `credentialless` keeps the page isolated
  // while dropping the CORP requirement for no-cors subresources. Every other
  // route keeps the stricter require-corp.
  const path = request.nextUrl.pathname;
  const coep = path === '/s' || path.startsWith('/s/') ? 'credentialless' : 'require-corp';
  response.headers.set('Cross-Origin-Embedder-Policy', coep);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json).*)'],
};
