import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncWebDavSelection } from '@/services/webdav/sync/engine';
import {
  getLocalBookPaths,
  getRemoteBookPaths,
  getLocalSyncStatePath,
} from '@/services/webdav/sync/paths';
import type { Book } from '@/types/book';
import type { AppService, BaseDir } from '@/types/system';
import type { WebDavProfile } from '@/services/webdav/models';

const server = vi.hoisted(() => ({
  files: new Map<string, { text: string; etag: string }>(),
  revision: 0,
}));

vi.mock('@/services/webdav/client/WebDavClient', () => ({
  WebDavClient: class {
    async mkcol() {
      return { ok: true, status: 201 };
    }
    async propfind(path: string) {
      const file = server.files.get(path);
      return {
        ok: !!file,
        status: file ? 207 : 404,
        data: file
          ? [{ isCollection: false, etag: file.etag, contentLength: file.text.length }]
          : [],
      };
    }
    async get(path: string) {
      const file = server.files.get(path);
      return {
        ok: !!file,
        status: file ? 200 : 404,
        headers: new Headers(file ? { etag: `"${file.etag}"` } : {}),
        data: file ? new TextEncoder().encode(file.text).buffer : undefined,
      };
    }
    async put(path: string, body: Uint8Array, options?: { ifMatch?: string }) {
      const current = server.files.get(path);
      if (options?.ifMatch && options.ifMatch !== `"${current?.etag}"`) {
        return { ok: false, status: 412, headers: new Headers() };
      }
      const etag = String(++server.revision);
      server.files.set(path, { text: new TextDecoder().decode(body), etag });
      return { ok: true, status: 201, headers: new Headers({ etag: `"${etag}"` }) };
    }
    async delete(path: string) {
      server.files.delete(path);
      return { ok: true, status: 204 };
    }
  },
}));

const book = { hash: 'book', title: 'Book', format: 'EPUB' } as Book;
const configPath = getLocalBookPaths(book).configFile;
const remoteConfigPath = getRemoteBookPaths(book).configFile;
const profile = {
  id: 'test',
  serverUrl: 'https://test.invalid',
  username: 'test',
  password: 'test',
  conflictStrategy: 'manual',
} as WebDavProfile;

const device = (config?: Record<string, unknown>) => {
  const files = new Map<string, string>();
  if (config) files.set(`Books/${configPath}`, JSON.stringify(config));
  const app = {
    exists: async (path: string, base: BaseDir) => files.has(`${base}/${path}`),
    readFile: async (path: string, base: BaseDir) => files.get(`${base}/${path}`),
    writeFile: async (path: string, base: BaseDir, text: string) => {
      files.set(`${base}/${path}`, text);
    },
    createDir: async () => {},
    deleteFile: async (path: string, base: BaseDir) => {
      files.delete(`${base}/${path}`);
    },
  } as unknown as AppService;
  return {
    read: () => JSON.parse(files.get(`Books/${configPath}`)!),
    readState: () => JSON.parse(files.get(`Settings/${getLocalSyncStatePath()}`)!),
    write: (value: Record<string, unknown>) =>
      files.set(`Books/${configPath}`, JSON.stringify(value)),
    sync: (books = [book]) =>
      syncWebDavSelection(app, profile, {
        books,
        includeBookFiles: false,
        includeCovers: false,
        includeLibrary: false,
        includeStatistics: false,
      }),
  };
};

const position = (location: string, time: number) => ({
  location,
  progressUpdatedAt: time,
  updatedAt: time,
});

beforeEach(() => {
  server.files.clear();
  server.revision = 0;
  let time = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => ++time);
});

afterEach(() => vi.restoreAllMocks());

describe('WebDAV progress across devices', () => {
  it('pulls the latest reading action instead of uploading a stale device snapshot', async () => {
    const pc = device(position('chapter-1', 10));
    const phone = device({ ...position('chapter-1', 10), viewSettings: { fontSize: 18 } });
    await pc.sync();
    await phone.sync();
    pc.write(position('chapter-3', 20));
    await pc.sync();

    expect(await phone.sync()).toEqual({ conflicts: [], failures: [] });
    expect(phone.read().location).toBe('chapter-3');
    expect(JSON.parse(server.files.get(remoteConfigPath)!.text).location).toBe('chapter-3');
  });

  it('merges simultaneous reading changes using their reading timestamps', async () => {
    const pc = device(position('chapter-1', 10));
    const phone = device(position('chapter-1', 10));
    await pc.sync();
    await phone.sync();
    pc.write(position('chapter-3', 30));
    phone.write(position('chapter-2', 20));
    await pc.sync();

    await phone.sync();
    expect(phone.read().location).toBe('chapter-3');
    expect(JSON.parse(server.files.get(remoteConfigPath)!.text).location).toBe('chapter-3');
  });

  it('downloads config on a new device without treating its absence as a deletion', async () => {
    const pc = device(position('chapter-3', 20));
    await pc.sync();
    const phone = device();

    expect(await phone.sync()).toEqual({ conflicts: [], failures: [] });
    expect(server.files.has(remoteConfigPath)).toBe(true);
    expect(phone.read().location).toBe('chapter-3');
  });

  it('checks progress on each sync even inside the binary file probe cache window', async () => {
    const pc = device(position('chapter-1', 10));
    await pc.sync();
    server.files.set(remoteConfigPath, {
      text: JSON.stringify(position('chapter-3', 20)),
      etag: String(++server.revision),
    });

    await pc.sync();
    expect(pc.read().location).toBe('chapter-3');
  });

  it('keeps newer remote progress when only a stale local config was saved', async () => {
    const pc = device(position('chapter-3', 30));
    await pc.sync();
    pc.write({ ...position('chapter-1', 10), updatedAt: 40 });

    await pc.sync();
    expect(pc.read().location).toBe('chapter-3');
    expect(JSON.parse(server.files.get(remoteConfigPath)!.text).location).toBe('chapter-3');
  });

  it('keeps the newer local reading action when remote layout changes arrive', async () => {
    const pc = device(position('chapter-3', 30));
    await pc.sync();
    server.files.set(remoteConfigPath, {
      text: JSON.stringify({ ...position('chapter-1', 10), updatedAt: 40 }),
      etag: String(++server.revision),
    });

    await pc.sync();
    expect(pc.read().location).toBe('chapter-3');
    expect(JSON.parse(server.files.get(remoteConfigPath)!.text).location).toBe('chapter-3');
  });

  it('does not import another device baseline for an item excluded from this sync', async () => {
    const pc = device(position('chapter-1', 10));
    const phone = device(position('chapter-1', 10));
    await pc.sync();
    await phone.sync();
    const baseline = phone.readState().entries[`Books/${configPath}`];
    pc.write(position('chapter-3', 30));
    await pc.sync();

    await phone.sync([]);
    expect(phone.readState().entries[`Books/${configPath}`]).toEqual(baseline);
    await phone.sync();
    expect(phone.read().location).toBe('chapter-3');
  });
});
