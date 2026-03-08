import http from 'http';
import { md5 } from '../../utils/md5';

type Entry =
  | { type: 'dir' }
  | { type: 'file'; data: Uint8Array; etag: string; lastModified: string };

const toUtcHttpDate = (date: Date) => date.toUTCString();

const ensureDir = (store: Map<string, Entry>, path: string) => {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const key = `/${current}`;
    if (!store.has(key)) store.set(key, { type: 'dir' });
  }
};

const getParentDir = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
};

const listChildren = (store: Map<string, Entry>, dirPath: string) => {
  const prefix = dirPath === '/' ? '/' : `${dirPath.replace(/\/+$/, '')}/`;
  const children = new Set<string>();
  for (const key of store.keys()) {
    if (!key.startsWith(prefix) || key === dirPath) continue;
    const rest = key.slice(prefix.length);
    const first = rest.split('/')[0];
    if (!first) continue;
    children.add(`${prefix}${first}`);
  }
  return Array.from(children.values()).sort();
};

const buildPropfindXml = (store: Map<string, Entry>, hrefs: string[]) => {
  const responses = hrefs
    .map((href) => {
      const entry = store.get(href);
      if (!entry) return '';
      const isDir = entry.type === 'dir';
      const etag = entry.type === 'file' ? entry.etag : '';
      const lastModified = entry.type === 'file' ? entry.lastModified : '';
      const contentLength = entry.type === 'file' ? entry.data.length : 0;
      const resourcetype = isDir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>';
      return (
        `<d:response>` +
        `<d:href>${href}${isDir && !href.endsWith('/') ? '/' : ''}</d:href>` +
        `<d:propstat>` +
        `<d:prop>` +
        resourcetype +
        (etag ? `<d:getetag>\"${etag}\"</d:getetag>` : '') +
        (lastModified ? `<d:getlastmodified>${lastModified}</d:getlastmodified>` : '') +
        (!isDir ? `<d:getcontentlength>${contentLength}</d:getcontentlength>` : '') +
        `</d:prop>` +
        `<d:status>HTTP/1.1 200 OK</d:status>` +
        `</d:propstat>` +
        `</d:response>`
      );
    })
    .join('');
  return `<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">${responses}</d:multistatus>`;
};

export const createMockWebDavServer = async (options: {
  username: string;
  password: string;
  basePathPrefix?: string;
}) => {
  const store = new Map<string, Entry>();
  store.set('/', { type: 'dir' });
  const basePrefix = options.basePathPrefix ?? '';

  const server = http.createServer(async (req, res) => {
    const auth = req.headers['authorization'];
    const expected = `Basic ${Buffer.from(`${options.username}:${options.password}`, 'utf-8').toString('base64')}`;
    if (auth !== expected) {
      res.statusCode = 401;
      res.end('Unauthorized');
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname || '/');
    const path = basePrefix && pathname.startsWith(basePrefix) ? pathname.slice(basePrefix.length) || '/' : pathname;
    const normalized = path === '' ? '/' : path;

    if (req.method === 'MKCOL') {
      ensureDir(store, normalized);
      res.statusCode = 201;
      res.end();
      return;
    }

    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      await new Promise((resolve) => req.on('end', resolve));
      const data = new Uint8Array(Buffer.concat(chunks));
      ensureDir(store, getParentDir(normalized));
      store.set(normalized, {
        type: 'file',
        data,
        etag: md5(Buffer.from(data).toString('binary')),
        lastModified: toUtcHttpDate(new Date()),
      });
      res.statusCode = 201;
      res.end();
      return;
    }

    if (req.method === 'GET') {
      const entry = store.get(normalized);
      if (!entry || entry.type !== 'file') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const range = req.headers['range'];
      if (typeof range === 'string' && range.startsWith('bytes=')) {
        const [startStr, endStr] = range.slice('bytes='.length).split('-');
        const start = Number.parseInt(startStr, 10);
        const end = endStr ? Number.parseInt(endStr, 10) : entry.data.length - 1;
        const clampedStart = Number.isFinite(start) ? Math.max(0, start) : 0;
        const clampedEnd = Number.isFinite(end) ? Math.min(entry.data.length - 1, end) : entry.data.length - 1;
        const slice = entry.data.slice(clampedStart, clampedEnd + 1);
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${clampedStart}-${clampedEnd}/${entry.data.length}`);
        res.end(Buffer.from(slice));
        return;
      }
      res.statusCode = 200;
      res.end(Buffer.from(entry.data));
      return;
    }

    if (req.method === 'DELETE') {
      store.delete(normalized);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'PROPFIND') {
      const depth = (req.headers['depth'] as string | undefined) ?? '1';
      const entry = store.get(normalized.endsWith('/') ? normalized.slice(0, -1) : normalized) ?? store.get(normalized);
      if (!entry) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const hrefBase = basePrefix ? `${basePrefix}${normalized}` : normalized;
      const selfHref = hrefBase === '' ? '/' : hrefBase;
      const hrefs: string[] = [];
      if (entry.type === 'dir') {
        const dirPath = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
        hrefs.push(dirPath === '' ? '/' : dirPath);
        if (depth === '1') {
          const children = listChildren(store, dirPath === '' ? '/' : dirPath);
          hrefs.push(...children);
        }
      } else {
        hrefs.push(normalized);
      }
      res.statusCode = 207;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.end(buildPropfindXml(store, hrefs));
      return;
    }

    res.statusCode = 405;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind');
  const port = address.port;

  return {
    store,
    serverUrl: `http://127.0.0.1:${port}${basePrefix}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

