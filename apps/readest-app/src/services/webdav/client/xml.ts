import { WebDavPropfindResource, WebDavQuota } from './types';
import { decodeHrefPathname, normalizeDavPath } from './utils';

const getFirstChildByLocalName = (el: Element, localName: string): Element | null => {
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) return child;
  }
  return null;
};

const getTextContentByLocalName = (el: Element, localName: string): string | undefined => {
  const target = el.getElementsByTagNameNS('*', localName)[0];
  const text = target?.textContent?.trim();
  return text ? text : undefined;
};

const hasElementByLocalName = (el: Element, localName: string): boolean => {
  return el.getElementsByTagNameNS('*', localName).length > 0;
};

export const parsePropfindResponse = (xmlText: string, options?: { baseUrl?: string; rootPath?: string }) => {
  const baseUrl = options?.baseUrl;
  const rootPath = options?.rootPath ? normalizeDavPath(options.rootPath) : '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const responses = Array.from(doc.getElementsByTagNameNS('*', 'response'));

  const resources: WebDavPropfindResource[] = [];
  for (const response of responses) {
    const href = getTextContentByLocalName(response, 'href');
    if (!href) continue;
    const pathname = decodeHrefPathname(href, baseUrl);
    const normalizedPath = normalizeDavPath(pathname);
    const relative = rootPath && normalizedPath.startsWith(`${rootPath}/`)
      ? normalizedPath.slice(rootPath.length)
      : rootPath === normalizedPath
        ? '/'
        : normalizedPath;
    const propstat = getFirstChildByLocalName(response, 'propstat');
    const prop = propstat ? getFirstChildByLocalName(propstat, 'prop') : null;
    const isCollection = prop ? hasElementByLocalName(prop, 'collection') : normalizedPath.endsWith('/');
    const etag = prop ? getTextContentByLocalName(prop, 'getetag') : undefined;
    const lastModified = prop ? getTextContentByLocalName(prop, 'getlastmodified') : undefined;
    const contentLengthText = prop ? getTextContentByLocalName(prop, 'getcontentlength') : undefined;
    const contentLength = contentLengthText ? Number.parseInt(contentLengthText, 10) : undefined;

    resources.push({
      href,
      path: relative,
      isCollection,
      etag: etag?.replace(/^W\//, '').replace(/^\"|\"$/g, ''),
      lastModified,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    });
  }

  return resources;
};

export const parseQuotaFromPropfindResponse = (xmlText: string): WebDavQuota => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const response = doc.getElementsByTagNameNS('*', 'response')[0];
  if (!response) return {};
  const propstat = response.getElementsByTagNameNS('*', 'propstat')[0];
  const prop = propstat?.getElementsByTagNameNS('*', 'prop')[0];
  if (!prop) return {};

  const usedText = getTextContentByLocalName(prop, 'quota-used-bytes');
  const availText = getTextContentByLocalName(prop, 'quota-available-bytes');

  const usedBytes = usedText ? Number.parseInt(usedText, 10) : undefined;
  const availableBytes = availText ? Number.parseInt(availText, 10) : undefined;

  return {
    usedBytes: Number.isFinite(usedBytes) ? usedBytes : undefined,
    availableBytes: Number.isFinite(availableBytes) ? availableBytes : undefined,
  };
};

