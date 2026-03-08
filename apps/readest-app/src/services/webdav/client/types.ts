export type WebDavDepth = '0' | '1' | 'infinity';

export type WebDavHttpMethod =
  | 'PROPFIND'
  | 'MKCOL'
  | 'GET'
  | 'PUT'
  | 'DELETE'
  | 'MOVE'
  | 'COPY'
  | 'HEAD';

export interface WebDavClientOptions {
  serverUrl: string;
  rootPath?: string;
  username?: string;
  password?: string;
  allowInsecureTls?: boolean;
  allowInsecureHttp?: boolean;
  defaultTimeoutMs?: number;
}

export interface WebDavResponse<T> {
  ok: boolean;
  status: number;
  headers: Headers;
  data?: T;
  error?: string;
}

export interface WebDavPropfindResource {
  href: string;
  path: string;
  isCollection: boolean;
  etag?: string;
  lastModified?: string;
  contentLength?: number;
}

export interface WebDavQuota {
  usedBytes?: number;
  availableBytes?: number;
}
