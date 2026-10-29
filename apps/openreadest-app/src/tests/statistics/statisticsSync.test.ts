import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  STATISTICS_SNAPSHOT_FORMAT,
  exportStatisticsSnapshot,
  importStatisticsSnapshot,
  parseStatisticsSnapshot,
  serializeStatisticsSnapshot,
  syncStatisticsWithWebDav,
  type StatisticsSyncClient,
} from '@/services/statistics/statisticsSync';
import type { WebDavResponse } from '@/services/webdav/client/types';
import type { DatabaseService } from '@/types/database';

// In-memory WebDAV file with ETag preconditions, like a real server.
class FakeDav implements StatisticsSyncClient {
  file: { text: string; etag: string } | null = null;
  puts = 0;
  beforePut: (() => void) | null = null;
  private version = 0;

  setRemote(text: string) {
    this.version += 1;
    this.file = { text, etag: '"v' + this.version + '"' };
  }

  async get(): Promise<WebDavResponse<ArrayBuffer>> {
    if (!this.file) return { ok: false, status: 404, headers: new Headers() };
    const data = new TextEncoder().encode(this.file.text).buffer as ArrayBuffer;
    return { ok: true, status: 200, headers: new Headers({ etag: this.file.etag }), data };
  }

  async put(
    _path: string,
    body: BodyInit,
    options?: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<WebDavResponse<void>> {
    this.puts += 1;
    const hook = this.beforePut;
    this.beforePut = null;
    hook?.();
    const stale = options?.ifMatch !== undefined && this.file?.etag !== options.ifMatch;
    const exists = options?.ifNoneMatch === '*' && this.file !== null;
    if (stale || exists) return { ok: false, status: 412, headers: new Headers() };
    this.setRemote(new TextDecoder().decode(body as Uint8Array));
    return { ok: true, status: 201, headers: new Headers() };
  }
}

describe('statistics WebDAV snapshot sync', () => {
  const dbs: DatabaseService[] = [];
  let server: FakeDav;

  const device = async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    dbs.push(db);
    return StatisticsDb.from(db);
  };
  const read = async (stats: StatisticsDb, md5: string, startTime: number, duration: number) => {
    const id = await stats.upsertBook({ bookMd5: md5, title: 'Title ' + md5, authors: 'Au' });
    await stats.insertPageEvent(id, { page: 1, startTime, duration, totalPages: 100 });
    await stats.recomputeBookTotals(id);
  };
  const text = async (stats: StatisticsDb) =>
    serializeStatisticsSnapshot(await exportStatisticsSnapshot(stats));
  const durations = async (stats: StatisticsDb) =>
    (await exportStatisticsSnapshot(stats)).pageStats.map((r) => r[3]);

  beforeEach(() => {
    server = new FakeDav();
  });

  afterEach(async () => {
    await Promise.all(dbs.splice(0).map((db) => db.close()));
  });

  it('round-trips books and page rows through statistics.json', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    await read(a, 'md5-a', 1030, 45);
    expect(await syncStatisticsWithWebDav(server, a)).toEqual({ status: 'pushed', attempts: 1 });

    const parsed = parseStatisticsSnapshot(server.file!.text);
    expect(parsed.ok && parsed.snapshot.format).toBe(STATISTICS_SNAPSHOT_FORMAT);
    expect(parsed.ok && parsed.snapshot.books['md5-a']).toEqual({
      title: 'Title md5-a',
      authors: 'Au',
      pages: 100,
    });

    const b = await device();
    expect(await syncStatisticsWithWebDav(server, b)).toEqual({ status: 'unchanged' });
    expect(await text(b)).toBe(await text(a));
    expect(await b.getBookByMd5('md5-a')).toMatchObject({ title: 'Title md5-a', total_read_time: 75 });
  });

  it('re-importing the same snapshot is a no-op and skips the upload', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    await syncStatisticsWithWebDav(server, a);
    const before = await text(a);
    const parsed = parseStatisticsSnapshot(server.file!.text);
    if (!parsed.ok) throw new Error(parsed.error);
    await importStatisticsSnapshot(a, parsed.snapshot);
    await importStatisticsSnapshot(a, parsed.snapshot);
    expect(await text(a)).toBe(before);
    expect(await syncStatisticsWithWebDav(server, a)).toEqual({ status: 'unchanged' });
    expect(server.puts).toBe(1);
  });

  it('resolves a page conflict with MAX(duration) in both directions', async () => {
    const a = await device();
    const b = await device();
    await read(a, 'md5-a', 1000, 10);
    await read(b, 'md5-a', 1000, 25);
    await syncStatisticsWithWebDav(server, b);
    expect(await syncStatisticsWithWebDav(server, a)).toEqual({ status: 'unchanged' });
    expect(await durations(a)).toEqual([25]);

    const c = await device();
    await read(c, 'md5-a', 1000, 40);
    expect((await syncStatisticsWithWebDav(server, c)).status).toBe('pushed');
    expect(await durations(c)).toEqual([40]);
    const parsed = parseStatisticsSnapshot(server.file!.text);
    expect(parsed.ok && parsed.snapshot.pageStats.map((r) => r[3])).toEqual([40]);
  });

  it('merges two devices, including a concurrent push between GET and PUT', async () => {
    const a = await device();
    const b = await device();
    await read(a, 'md5-a', 1000, 30);
    await read(b, 'md5-b', 2000, 50);
    const bText = await text(b);
    server.beforePut = () => server.setRemote(bText);
    expect(await syncStatisticsWithWebDav(server, a)).toEqual({ status: 'pushed', attempts: 2 });
    expect(await syncStatisticsWithWebDav(server, b)).toEqual({ status: 'unchanged' });
    expect(await text(a)).toBe(await text(b));
    expect(Object.keys((await exportStatisticsSnapshot(a)).books)).toEqual(['md5-a', 'md5-b']);
  });

  it('does not let a placeholder title overwrite a real one', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    await importStatisticsSnapshot(a, {
      format: STATISTICS_SNAPSHOT_FORMAT,
      version: 1,
      books: { 'md5-a': { title: 'md5-a', authors: '', pages: 100 } },
      pageStats: [['md5-a', 2, 1100, 20, 100]],
    });
    expect(await a.getBookByMd5('md5-a')).toMatchObject({ title: 'Title md5-a', total_read_time: 50 });
  });
});
