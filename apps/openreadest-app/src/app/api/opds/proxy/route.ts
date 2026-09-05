import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { isBlockedHost } from '@/utils/network';
import { NextRequest, NextResponse } from 'next/server';

// Cap redirect hops so the SSRF host check below can re-run on every one.
const MAX_REDIRECTS = 5;

// 开发模式下允许局域网地址（本地 OPDS 服务器是 dev 常见用例）；
// 与 CatelogManager 的 web+production 拦截语义对齐。
const allowPrivateHosts = () => process.env.NODE_ENV === 'development';

class SsrfBlockedError extends Error {}

/**
 * Fetch the target while running the SSRF host check on every redirect hop.
 * `fetch`'s default `redirect: 'follow'` would let a public URL 302 to an
 * internal address (e.g. the cloud metadata endpoint) after our initial host
 * check passed, so we follow redirects manually and re-validate each hop.
 * Throws `SsrfBlockedError` when a hop targets a blocked host or scheme.
 */
async function fetchFollowingRedirects(
  startUrl: string,
  init: { method: 'GET' | 'HEAD'; headers: HeadersInit; signal: AbortSignal },
): Promise<Response> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SsrfBlockedError('Only http(s) URLs are supported');
    }
    if (!allowPrivateHosts() && isBlockedHost(parsed.hostname)) {
      throw new SsrfBlockedError('This URL is not allowed');
    }
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      currentUrl = new URL(response.headers.get('location')!, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new SsrfBlockedError('Too many redirects');
}

async function handleRequest(request: NextRequest, method: 'GET' | 'HEAD') {
  // Cloudflare Workers incorrectly decodes %26 to & in the url parameter value,
  // causing query parameters within the proxied URL (like &start_index=26) to be
  // treated as separate top-level parameters instead of part of the url value.
  // We work around this by manually extracting the url parameter - capturing everything
  // from 'url=' until we hit our known parameters (&stream= or &auth=), then decoding it.
  const fullUrl = request.url;
  const urlParamStart = fullUrl.indexOf('url=') + 4;
  const streamParam = fullUrl.lastIndexOf('&stream=');
  const authParam = fullUrl.lastIndexOf('&auth=');
  const urlParamEnd = Math.min(...[streamParam, authParam].filter((i) => i > 0), fullUrl.length);
  const encodedUrl = fullUrl.substring(urlParamStart, urlParamEnd);
  const url = decodeURIComponent(encodedUrl);
  const auth = request.nextUrl.searchParams.get('auth');
  const stream = request.nextUrl.searchParams.get('stream');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing URL parameter. Usage: /api/opds/proxy?url=YOUR_OPDS_URL' },
      { status: 400 },
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  // SSRF guard: this proxy fetches an arbitrary client-supplied URL server-side,
  // so reject non-http(s) schemes and internal/loopback/link-local targets
  // before making any request (the redirect loop re-checks every hop).
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only http(s) URLs are supported' }, { status: 400 });
  }
  if (!allowPrivateHosts() && isBlockedHost(parsedUrl.hostname)) {
    return NextResponse.json({ error: 'This URL is not allowed' }, { status: 400 });
  }

  try {
    console.log(`[OPDS Proxy] ${method}: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const headers: HeadersInit = {
      'User-Agent': READEST_OPDS_USER_AGENT,
      Accept: 'application/atom+xml, application/xml, text/xml, application/json, */*',
    };

    if (auth) {
      headers['Authorization'] = auth;
    }

    const response = await fetchFollowingRedirects(url, {
      method,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[OPDS Proxy] HTTP ${response.status} for ${url}`);
      if (method === 'HEAD') {
        if (response.status === 401) {
          return new NextResponse(null, {
            status: 403,
            headers: {
              ...Object.fromEntries(response.headers.entries()),
              'Cache-Control': 'public, max-age=300',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          });
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.text();
      if (response.status === 401) {
        return new NextResponse(data, {
          status: 403,
          headers: {
            ...Object.fromEntries(response.headers.entries()),
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }
      return new NextResponse(data, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const contentType = response.headers.get('Content-Type') || 'text/xml';
    const contentLength = response.headers.get('Content-Length');

    if (method === 'HEAD') {
      console.log(`[OPDS Proxy] HEAD Success: ${url}`);
      return new NextResponse(null, {
        status: 200,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Content-Type': contentType,
          'Content-Length': contentLength || '',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 流式透传条件：显式 stream=true、上游未返回 Content-Length（chunked，
    // 长度未知）、或长度超过 1MB。长度未知时不做 arrayBuffer() 一次性缓冲，
    // 否则恶意/异常的上游响应会把代理进程内存打爆（OOM）。
    if (stream === 'true' || !contentLength || parseInt(contentLength) > 1024 * 1024) {
      console.log(`[OPDS Proxy] Streaming: ${url}`);

      return new NextResponse(response.body, {
        status: 200,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Content-Type': contentType,
          'X-Content-Length': contentLength || '',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Expose-Headers': 'X-Content-Length',
        },
      });
    } else {
      const buf = await response.arrayBuffer();
      const length = buf.byteLength;
      console.log(`[OPDS Proxy] Success: ${url} (${length} bytes)`);

      return new NextResponse(buf, {
        status: 200,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Content-Type': contentType,
          'Content-Length': length.toString(),
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
  } catch (error) {
    console.error('[OPDS Proxy] Error:', error);

    if (error instanceof SsrfBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request timeout - the OPDS server took too long to respond' },
          { status: 504 },
        );
      }

      return NextResponse.json(
        {
          error: error.message,
          url: url,
          hint: 'Check if the OPDS URL is accessible and returns valid OPDS/Atom/JSON content',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: 'Failed to fetch OPDS feed', url: url }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return handleRequest(request, 'HEAD');
}

export async function OPTIONS(_: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
