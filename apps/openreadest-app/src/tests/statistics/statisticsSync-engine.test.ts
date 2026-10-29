import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { REMOTE_STATISTICS_PATH } from '@/services/statistics/statisticsSync';
import { syncWebDavSelection } from '@/services/webdav/sync/engine';
import type { WebDavProfile } from '@/services/webdav/models';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('@/services/webdav/client/WebDavClient', () => ({
  WebDavClient: class {
    async mkcol() {
      return { ok: true, status: 201, headers: new Headers() };
    }
    async propfind() {
      return { ok: true, status: 207, headers: new Headers(), data: [] };
    }
    async get(path: string) {
      calls.push('GET ' + path);
      return { ok: false, status: 404, headers: new Headers() };
    }
    async put(path: string) {
      calls.push('PUT ' + path);
      return { ok: true, status: 201, headers: new Headers({ etag: '"e1"' }) };
    }
    async delete() {
      return { ok: true, status: 204, headers: new Headers() };
    }
  },
}));

// Every AppService call resolves to nothing; no local files exist.
const appService = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'then') return undefined;
      if (prop === 'exists') return async () => false;
      return async () => undefined;
    },
  },
) as AppService;

// The client is mocked, so serverUrl is only a cache key and never dialed.
const profile = {
  id: 'p1',
  name: 'test',
  serverUrl: 'dav-test-server',
  remotePath: '/',
  username: 'u',
  password: 'p',
  conflictStrategy: 'local',
} as unknown as WebDavProfile;

const touchedStatistics = () => calls.some((c) => c.endsWith(REMOTE_STATISTICS_PATH));

describe('syncWebDavSelection statistics item', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    calls.length = 0;
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    const id = await stats.upsertBook({ bookMd5: 'md5-a', title: 'A', authors: '' });
    await stats.insertPageEvent(id, { page: 1, startTime: 10, duration: 20, totalPages: 5 });
    vi.spyOn(StatisticsDb, 'open').mockResolvedValue(stats);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it('pulls, merges and pushes statistics.json by default', async () => {
    await syncWebDavSelection(appService, profile, { books: [], includeLibrary: false });
    expect(StatisticsDb.open).toHaveBeenCalledTimes(1);
    expect(calls).toContain('GET ' + REMOTE_STATISTICS_PATH);
    expect(calls).toContain('PUT ' + REMOTE_STATISTICS_PATH);
  });

  it('skips statistics entirely when includeStatistics is false', async () => {
    await syncWebDavSelection(appService, profile, {
      books: [],
      includeLibrary: false,
      includeStatistics: false,
    });
    expect(StatisticsDb.open).not.toHaveBeenCalled();
    expect(touchedStatistics()).toBe(false);
  });

  it('skips statistics on a dry run', async () => {
    await syncWebDavSelection(appService, profile, {
      books: [],
      includeLibrary: false,
      dryRun: true,
    });
    expect(StatisticsDb.open).not.toHaveBeenCalled();
    expect(touchedStatistics()).toBe(false);
  });
});
