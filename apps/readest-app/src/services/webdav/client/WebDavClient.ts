import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { WebDavClientOptions, WebDavDepth, WebDavPropfindResource, WebDavQuota, WebDavResponse } from './types';
import { basicAuthHeaderValue, joinDavPaths, normalizeRootPath, normalizeServerUrl, normalizeDavPath } from './utils';
import { parsePropfindResponse, parseQuotaFromPropfindResponse } from './xml';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('请求超时')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

export class WebDavClient {
  private serverUrl: string;
  private rootPath: string;
  private username?: string;
  private password?: string;
  private allowInsecureTls: boolean;
  private defaultTimeoutMs: number;

  constructor(options: WebDavClientOptions) {
    const serverUrl = normalizeServerUrl(options.serverUrl);
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('服务器地址无效');
    }
    if (parsed.protocol === 'http:' && !options.allowInsecureHttp) {
      throw new Error('不允许使用不安全的 HTTP 连接');
    }

    this.serverUrl = serverUrl;
    this.rootPath = normalizeRootPath(options.rootPath);
    this.username = options.username;
    this.password = options.password;
    this.allowInsecureTls = !!options.allowInsecureTls;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
  }

  private buildUrl(path: string): string {
    const normalized = normalizeDavPath(path);
    const joinedPath = joinDavPaths(this.rootPath, normalized);
    const encodedPath = joinedPath
      .split('/')
      .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
      .join('/');
    return `${this.serverUrl}${encodedPath}`;
  }

  private buildHeaders(additional?: HeadersInit): Headers {
    const headers = new Headers(additional);
    if (this.username && this.password) {
      headers.set('Authorization', basicAuthHeaderValue(this.username, this.password));
    }
    return headers;
  }

  private async requestText(
    path: string,
    options: {
      method: string;
      headers?: HeadersInit;
      body?: BodyInit | null;
      timeoutMs?: number;
    },
  ): Promise<WebDavResponse<string>> {
    const url = this.buildUrl(path);
    const headers = this.buildHeaders(options.headers);

    const fetchImpl = isTauriAppPlatform() ? (tauriFetch as unknown as typeof fetch) : fetch;
    const requestInit: RequestInit & { danger?: { acceptInvalidCerts: boolean; acceptInvalidHostnames: boolean } } =
      {
        method: options.method,
        headers,
        body: options.body ?? null,
      };

    if (isTauriAppPlatform()) {
      requestInit.danger = {
        acceptInvalidCerts: this.allowInsecureTls,
        acceptInvalidHostnames: this.allowInsecureTls,
      };
    }

    try {
      const response = await withTimeout(fetchImpl(url, requestInit), options.timeoutMs ?? this.defaultTimeoutMs);
      const text = await response.text();
      return { ok: response.ok, status: response.status, headers: response.headers, data: text };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        headers: new Headers(),
        error: (e as Error).message || '请求失败',
      };
    }
  }

  private async requestBinary(
    path: string,
    options: {
      method: string;
      headers?: HeadersInit;
      body?: BodyInit | null;
      timeoutMs?: number;
    },
  ): Promise<WebDavResponse<ArrayBuffer>> {
    const url = this.buildUrl(path);
    const headers = this.buildHeaders(options.headers);

    const fetchImpl = isTauriAppPlatform() ? (tauriFetch as unknown as typeof fetch) : fetch;
    const requestInit: RequestInit & { danger?: { acceptInvalidCerts: boolean; acceptInvalidHostnames: boolean } } =
      {
        method: options.method,
        headers,
        body: options.body ?? null,
      };

    if (isTauriAppPlatform()) {
      requestInit.danger = {
        acceptInvalidCerts: this.allowInsecureTls,
        acceptInvalidHostnames: this.allowInsecureTls,
      };
    }

    try {
      const response = await withTimeout(fetchImpl(url, requestInit), options.timeoutMs ?? this.defaultTimeoutMs);
      const data = await response.arrayBuffer();
      return { ok: response.ok, status: response.status, headers: response.headers, data };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        headers: new Headers(),
        error: (e as Error).message || '请求失败',
      };
    }
  }

  async propfind(
    path: string,
    options?: { depth?: WebDavDepth; timeoutMs?: number; includeQuota?: boolean },
  ): Promise<WebDavResponse<WebDavPropfindResource[]>> {
    const depth = options?.depth ?? '1';
    const props = [
      'resourcetype',
      'getetag',
      'getlastmodified',
      'getcontentlength',
      ...(options?.includeQuota ? ['quota-used-bytes', 'quota-available-bytes'] : []),
    ];

    const body =
      `<?xml version=\"1.0\" encoding=\"utf-8\"?>` +
      `<d:propfind xmlns:d=\"DAV:\">` +
      `<d:prop>${props.map((p) => `<d:${p}/>`).join('')}</d:prop>` +
      `</d:propfind>`;

    const response = await this.requestText(path, {
      method: 'PROPFIND',
      timeoutMs: options?.timeoutMs,
      headers: {
        Depth: depth,
        Accept: 'application/xml',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    });

    if (!response.ok || !response.data) {
      return { ok: false, status: response.status, headers: response.headers, error: response.error || '请求失败' };
    }

    try {
      const resources = parsePropfindResponse(response.data, {
        baseUrl: this.serverUrl,
        rootPath: this.rootPath,
      });
      return { ok: true, status: response.status, headers: response.headers, data: resources };
    } catch (e) {
      return { ok: false, status: response.status, headers: response.headers, error: (e as Error).message };
    }
  }

  async getQuota(path: string = '/'): Promise<WebDavResponse<WebDavQuota>> {
    const response = await this.requestText(path, {
      method: 'PROPFIND',
      headers: {
        Depth: '0',
        Accept: 'application/xml',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body:
        `<?xml version=\"1.0\" encoding=\"utf-8\"?>` +
        `<d:propfind xmlns:d=\"DAV:\">` +
        `<d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop>` +
        `</d:propfind>`,
    });

    if (!response.ok || !response.data) {
      return { ok: false, status: response.status, headers: response.headers, error: response.error || '请求失败' };
    }

    try {
      return { ok: true, status: response.status, headers: response.headers, data: parseQuotaFromPropfindResponse(response.data) };
    } catch (e) {
      return { ok: false, status: response.status, headers: response.headers, error: (e as Error).message };
    }
  }

  async mkcol(path: string): Promise<WebDavResponse<void>> {
    const response = await this.requestText(path, { method: 'MKCOL' });
    const ok = response.ok || response.status === 405;
    return { ok, status: response.status, headers: response.headers, error: ok ? undefined : response.error };
  }

  async delete(path: string): Promise<WebDavResponse<void>> {
    const response = await this.requestText(path, { method: 'DELETE' });
    return { ok: response.ok, status: response.status, headers: response.headers, error: response.ok ? undefined : response.error };
  }

  async get(path: string, options?: { range?: { start: number; end?: number }; ifRange?: string }): Promise<WebDavResponse<ArrayBuffer>> {
    const headers: Record<string, string> = {};
    if (options?.range) {
      headers['Range'] = `bytes=${options.range.start}-${options.range.end ?? ''}`;
    }
    if (options?.ifRange) {
      headers['If-Range'] = options.ifRange;
    }
    return this.requestBinary(path, { method: 'GET', headers });
  }

  async put(
    path: string,
    body: BodyInit,
    options?: { contentType?: string; ifMatch?: string; ifNoneMatch?: string },
  ): Promise<WebDavResponse<void>> {
    const headers: Record<string, string> = {};
    if (options?.contentType) headers['Content-Type'] = options.contentType;
    if (options?.ifMatch) headers['If-Match'] = options.ifMatch;
    if (options?.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch;
    const response = await this.requestText(path, { method: 'PUT', headers, body });
    return { ok: response.ok, status: response.status, headers: response.headers, error: response.ok ? undefined : response.error };
  }

  async move(
    srcPath: string,
    destPath: string,
    options?: { overwrite?: boolean },
  ): Promise<WebDavResponse<void>> {
    const destinationUrl = this.buildUrl(destPath);
    const response = await this.requestText(srcPath, {
      method: 'MOVE',
      headers: {
        Destination: destinationUrl,
        Overwrite: options?.overwrite === false ? 'F' : 'T',
      },
    });
    return { ok: response.ok, status: response.status, headers: response.headers, error: response.ok ? undefined : response.error };
  }

  async copy(
    srcPath: string,
    destPath: string,
    options?: { overwrite?: boolean },
  ): Promise<WebDavResponse<void>> {
    const destinationUrl = this.buildUrl(destPath);
    const response = await this.requestText(srcPath, {
      method: 'COPY',
      headers: {
        Destination: destinationUrl,
        Overwrite: options?.overwrite === false ? 'F' : 'T',
      },
    });
    return { ok: response.ok, status: response.status, headers: response.headers, error: response.ok ? undefined : response.error };
  }
}
