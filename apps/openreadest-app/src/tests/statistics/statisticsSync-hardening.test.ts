import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  STATISTICS_SNAPSHOT_FORMAT,
  buildStatisticsSnapshot,
  exportStatisticsSnapshot,
  importStatisticsSnapshot,
  parseStatisticsSnapshot,
  serializeStatisticsSnapshot,
  syncStatisticsWithWebDav,
  type StatisticsSnapshotV1,
  type StatisticsSyncClient,
} from '@/services/statistics/statisticsSync';
import type { WebDavResponse } from '@/services/webdav/client/types';
import type { DatabaseService } from '@/types/database';

type PutOptions = { ifMatch?: string; ifNoneMatch?: string };

// In-memory WebDAV file that can misbehave: weak or missing ETags, failing
// GET/PUT, and hooks to simulate another device writing mid-sync.
class Dav implements StatisticsSyncClient {
  file: { text: string; etag: string } | null = null;
  etagMode: 'strong' | 'weak' | 'none' = 'strong';
  gets = 0;
  onGet: ((n: number) => void) | null = null;
  getOverride: WebDavResponse<ArrayBuffer> | null = null;
  beforePut: (() => void) | null = null;
  putStatus: number | null = null;
  putOptions: PutOptions[] = [];
  private version = 0;

  setRemote(text: string) {
    this.version += 1;
    this.file = { text, etag: '"v' + this.version + '"' };
  }

  async get(): Promise<WebDavResponse<ArrayBuffer>> {
    this.gets += 1;
    this.onGet?.(this.gets);
    if (this.getOverride) return this.getOverride;
    if (!this.file) return { ok: false, status: 404, headers: new Headers() };
    const headers = new Headers();
    if (this.etagMode === 'strong') headers.set('etag', this.file.etag);
    if (this.etagMode === 'weak') headers.set('etag', 'W/' + this.file.etag);
    const data = new TextEncoder().encode(this.file.text).buffer as ArrayBuffer;
    return { ok: true, status: 200, headers, data };
  }

  async put(path: string, body: BodyInit, options?: PutOptions): Promise<WebDavResponse<void>> {
    void path;
    this.putOptions.push({ ifMatch: options?.ifMatch, ifNoneMatch: options?.ifNoneMatch });
    const hook = this.beforePut;
    this.beforePut = null;
    hook?.();
    if (this.putStatus !== null) {
      return { ok: false, status: this.putStatus, headers: new Headers(), error: 'boom' };
    }
    const stale = options?.ifMatch !== undefined && this.file?.etag !== options.ifMatch;
    const exists = options?.ifNoneMatch === '*' && this.file !== null;
    if (stale || exists) return { ok: false, status: 412, headers: new Headers() };
    this.setRemote(new TextDecoder().decode(body as Uint8Array));
    return { ok: true, status: 201, headers: new Headers() };
  }
}

const valid = {
  format: STATISTICS_SNAPSHOT_FORMAT,
  version: 1,
  books: { 'md5-a': { title: 'A', authors: 'Au', pages: 10 } },
  pageStats: [['md5-a', 1, 1000, 30, 10]],
};

// JSON.stringify cannot emit 1e999 (it becomes null), so splice it in as text.
const withValue = (target: 'row' | 'pages', index: number, value: number | string): string => {
  const doc = structuredClone(valid) as {
    books: Record<string, Record<string, unknown>>;
    pageStats: unknown[][];
  };
  const v = value === 'inf' ? '__INF__' : value;
  if (target === 'row') doc.pageStats[0]![index] = v;
  else doc.books['md5-a']!['pages'] = v;
  return JSON.stringify({ ...valid, ...doc }).replace('"__INF__"', '1e999');
};

const strictCases: Array<[string, string]> = [];
for (const [index, field] of [
  [1, 'page'],
  [2, 'startTime'],
  [3, 'duration'],
  [4, 'totalPages'],
] as const) {
  for (const value of [1.5, -1, 'inf'] as const) {
    strictCases.push([field + ' = ' + String(value), withValue('row', index, value)]);
  }
}
for (const value of [1.5, -1, 'inf'] as const) {
  strictCases.push(['books[].pages = ' + String(value), withValue('pages', 0, value)]);
}

const snapshot = (
  books: StatisticsSnapshotV1['books'],
  pageStats: StatisticsSnapshotV1['pageStats'],
): StatisticsSnapshotV1 => ({ format: STATISTICS_SNAPSHOT_FORMAT, version: 1, books, pageStats });

describe('statistics snapshot sync hardening', () => {
  const dbs: DatabaseService[] = [];
  let server: Dav;

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

  beforeEach(() => {
    server = new Dav();
  });

  afterEach(async () => {
    await Promise.all(dbs.splice(0).map((db) => db.close()));
  });

  it.each(strictCases)('rejects a non-integer or out-of-range %s', (_label, raw) => {
    expect(parseStatisticsSnapshot(raw).ok).toBe(false);
  });

  it('syncs idempotently over legacy duplicate book rows for one md5', async () => {
    const a = await device();
    const seed = async (title: string) => {
      await a.database.execute(
        'INSERT INTO book (title, authors, md5, notes, last_open, highlights, pages, total_read_time, total_read_pages) ' +
          'VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)',
        [title, 'A', 'md5-dup'],
      );
      const rows = await a.database.select<{ id: number }>(
        'SELECT id FROM book WHERE title = ? AND md5 = ?',
        [title, 'md5-dup'],
      );
      return rows[0]!.id;
    };
    const t1 = await seed('T1');
    const t2 = await seed('T2');
    await a.insertPageEvent(t1, { page: 1, startTime: 1000, duration: 30, totalPages: 10 });
    await a.insertPageEvent(t2, { page: 2, startTime: 2000, duration: 40, totalPages: 10 });

    // Renaming the first row onto the second's metadata must not hit UNIQUE.
    await expect(a.upsertBook({ bookMd5: 'md5-dup', title: 'T2', authors: 'A' })).resolves.toBe(t1);

    server.setRemote(
      serializeStatisticsSnapshot(
        snapshot({ 'md5-dup': { title: 'T2', authors: 'A', pages: 10 } }, [
          ['md5-dup', 3, 3000, 50, 10],
        ]),
      ),
    );
    expect((await syncStatisticsWithWebDav(server, a)).status).toBe('pushed');
    expect(await syncStatisticsWithWebDav(server, a)).toEqual({ status: 'unchanged' });
    const rows = await a.database.select<{ id: number }>('SELECT id FROM book WHERE md5 = ?', [
      'md5-dup',
    ]);
    expect(rows).toHaveLength(2);
    const exported = await exportStatisticsSnapshot(a);
    expect(exported.pageStats.map((r) => r[3]).sort()).toEqual([30, 40, 50]);
  });

  it('never lets an empty title overwrite real metadata', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    await importStatisticsSnapshot(
      a,
      snapshot({ 'md5-a': { title: '', authors: '', pages: 0 } }, [['md5-a', 2, 1100, 20, 100]]),
    );
    expect(await a.getBookByMd5('md5-a')).toMatchObject({ title: 'Title md5-a', authors: 'Au' });

    // Snapshot side: a blank legacy row never shadows the real one for the same md5.
    const built = buildStatisticsSnapshot({
      books: [
        { bookMd5: 'md5-x', title: '', authors: '', pages: 0 },
        { bookMd5: 'md5-x', title: 'Real', authors: 'Au', pages: 5 },
      ],
      events: [],
    });
    expect(built.books['md5-x']).toEqual({ title: 'Real', authors: 'Au', pages: 5 });
  });

  it.each(['weak', 'none'] as const)(
    'with a %s ETag re-reads before the unconditional PUT and re-merges a concurrent push',
    async (mode) => {
      const a = await device();
      const b = await device();
      const c = await device();
      await read(a, 'md5-a', 1000, 30);
      await read(b, 'md5-b', 2000, 50);
      await read(c, 'md5-c', 3000, 20);
      const bText = await text(b);
      const bParsed = parseStatisticsSnapshot(bText);
      if (!bParsed.ok) throw new Error(bParsed.error);
      await importStatisticsSnapshot(c, bParsed.snapshot);
      const cText = await text(c);

      server.etagMode = mode;
      server.setRemote(bText);
      // Device c pushes between a's first GET and its pre-PUT re-read.
      server.onGet = (n) => {
        if (n === 2) server.setRemote(cText);
      };
      expect(await syncStatisticsWithWebDav(server, a)).toEqual({ status: 'pushed', attempts: 2 });
      expect(server.putOptions).toEqual([{ ifMatch: undefined, ifNoneMatch: undefined }]);
      const final = parseStatisticsSnapshot(server.file!.text);
      expect(final.ok && Object.keys(final.snapshot.books)).toEqual(['md5-a', 'md5-b', 'md5-c']);
    },
  );

  it('retries a lost If-None-Match:* create race by re-pulling', async () => {
    const a = await device();
    const b = await device();
    await read(a, 'md5-a', 1000, 30);
    await read(b, 'md5-b', 2000, 50);
    const bText = await text(b);
    server.beforePut = () => server.setRemote(bText);
    expect(await syncStatisticsWithWebDav(server, a)).toEqual({ status: 'pushed', attempts: 2 });
    expect(server.putOptions[0]).toEqual({ ifMatch: undefined, ifNoneMatch: '*' });
    expect(server.putOptions[1]?.ifMatch).toBeDefined();
    const final = parseStatisticsSnapshot(server.file!.text);
    expect(final.ok && Object.keys(final.snapshot.books)).toEqual(['md5-a', 'md5-b']);
  });

  it('fails after three consecutive 412s', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    server.putStatus = 412;
    expect((await syncStatisticsWithWebDav(server, a)).status).toBe('failed');
    expect(server.putOptions).toHaveLength(3);
  });

  it('fails without uploading on a 200 with an empty body', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    server.getOverride = { ok: true, status: 200, headers: new Headers(), data: new ArrayBuffer(0) };
    expect((await syncStatisticsWithWebDav(server, a)).status).toBe('failed');
    expect(server.putOptions).toHaveLength(0);
  });

  it('fails without uploading on a GET 5xx', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    server.getOverride = { ok: false, status: 503, headers: new Headers() };
    expect((await syncStatisticsWithWebDav(server, a)).status).toBe('failed');
    expect(server.putOptions).toHaveLength(0);
  });

  it('fails on a PUT error other than 412 without retrying', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    server.putStatus = 500;
    expect((await syncStatisticsWithWebDav(server, a)).status).toBe('failed');
    expect(server.putOptions).toHaveLength(1);
  });

  it('keeps a tracker write that runs concurrently with an import', async () => {
    const a = await device();
    await read(a, 'md5-a', 1000, 30);
    const id = (await a.getBookByMd5('md5-a'))!.id;
    await Promise.all([
      importStatisticsSnapshot(
        a,
        snapshot({ 'md5-b': { title: 'B', authors: 'Bu', pages: 10 } }, [['md5-b', 1, 5000, 40, 10]]),
      ),
      a.insertPageEvent(id, { page: 2, startTime: 1100, duration: 15, totalPages: 100 }),
    ]);
    const rows = (await exportStatisticsSnapshot(a)).pageStats;
    expect(rows.map((r) => [r[0], r[3]])).toEqual([
      ['md5-a', 30],
      ['md5-a', 15],
      ['md5-b', 40],
    ]);
  });
});
