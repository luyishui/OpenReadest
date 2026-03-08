export const normalizeServerUrl = (serverUrl: string): string => {
  return serverUrl.replace(/\/+$/, '');
};

export const normalizeRootPath = (rootPath?: string): string => {
  if (!rootPath) return '';
  const trimmed = rootPath.trim();
  if (!trimmed) return '';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
};

export const normalizeDavPath = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/{2,}/g, '/');
};

export const joinDavPaths = (...parts: string[]): string => {
  const normalized = parts
    .filter(Boolean)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/(^\/+|\/+$)/g, ''));
  return `/${normalized.join('/')}`.replace(/\/{2,}/g, '/');
};

export const toBase64 = (value: string): string => {
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value, 'utf-8').toString('base64');
};

export const basicAuthHeaderValue = (username: string, password: string): string => {
  return `Basic ${toBase64(`${username}:${password}`)}`;
};

export const decodeHrefPathname = (href: string, baseUrl?: string): string => {
  const raw = href.trim();
  if (!raw) return '/';
  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    return decodeURIComponent(url.pathname || '/');
  } catch {
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return decodeURIComponent(path);
  }
};

