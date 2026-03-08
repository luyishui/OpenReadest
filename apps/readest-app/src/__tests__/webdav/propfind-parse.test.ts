import { describe, it, expect } from 'vitest';
import { parsePropfindResponse, parseQuotaFromPropfindResponse } from '../../services/webdav/client/xml';
import { joinDavPaths, normalizeRootPath } from '../../services/webdav/client/utils';

describe('WebDAV XML parsing', () => {
  it('parses PROPFIND multistatus resources', () => {
    const xml =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<d:multistatus xmlns:d="DAV:">` +
      `<d:response>` +
      `<d:href>/dav/books/</d:href>` +
      `<d:propstat><d:prop>` +
      `<d:resourcetype><d:collection/></d:resourcetype>` +
      `</d:prop></d:propstat>` +
      `</d:response>` +
      `<d:response>` +
      `<d:href>/dav/books/Books/library.json</d:href>` +
      `<d:propstat><d:prop>` +
      `<d:getetag>W/"etag-123"</d:getetag>` +
      `<d:getlastmodified>Mon, 01 Jan 2026 00:00:00 GMT</d:getlastmodified>` +
      `<d:getcontentlength>42</d:getcontentlength>` +
      `<d:resourcetype/>` +
      `</d:prop></d:propstat>` +
      `</d:response>` +
      `</d:multistatus>`;

    const resources = parsePropfindResponse(xml, {
      baseUrl: 'https://dav.example.com',
      rootPath: '/dav/books',
    });

    expect(resources.length).toBe(2);
    expect(resources[0]).toMatchObject({
      path: '/',
      isCollection: true,
    });
    expect(resources[1]).toMatchObject({
      path: '/Books/library.json',
      isCollection: false,
      etag: 'etag-123',
      contentLength: 42,
    });
  });

  it('parses quota properties', () => {
    const xml =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<d:multistatus xmlns:d="DAV:">` +
      `<d:response>` +
      `<d:href>/dav/books/</d:href>` +
      `<d:propstat><d:prop>` +
      `<d:quota-used-bytes>100</d:quota-used-bytes>` +
      `<d:quota-available-bytes>900</d:quota-available-bytes>` +
      `</d:prop></d:propstat>` +
      `</d:response>` +
      `</d:multistatus>`;

    expect(parseQuotaFromPropfindResponse(xml)).toEqual({ usedBytes: 100, availableBytes: 900 });
  });
});

describe('WebDAV path utilities', () => {
  it('normalizes root path', () => {
    expect(normalizeRootPath('')).toBe('');
    expect(normalizeRootPath('remote/path/')).toBe('/remote/path');
    expect(normalizeRootPath('/remote/path/')).toBe('/remote/path');
  });

  it('joins paths as WebDAV paths', () => {
    expect(joinDavPaths('/remote', '/Books/library.json')).toBe('/remote/Books/library.json');
    expect(joinDavPaths('/remote/', 'Books', 'x')).toBe('/remote/Books/x');
  });
});

