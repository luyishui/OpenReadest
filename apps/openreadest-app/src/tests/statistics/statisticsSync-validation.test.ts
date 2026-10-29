import { describe, it, expect, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  STATISTICS_SNAPSHOT_FORMAT,
  parseStatisticsSnapshot,
  syncStatisticsWithWebDav,
} from '@/services/statistics/statisticsSync';
import type { DatabaseService } from '@/types/database';

const valid = {
  format: STATISTICS_SNAPSHOT_FORMAT,
  version: 1,
  books: { 'md5-a': { title: 'A', authors: 'Au', pages: 10 } },
  pageStats: [['md5-a', 1, 1000, 30, 10]],
};

const invalidTexts: Array<[string, string]> = [
  ['broken JSON', '{"format":'],
  ['non-object', '[]'],
  ['unknown format', JSON.stringify({ ...valid, format: 'other' })],
  ['missing version', JSON.stringify({ ...valid, version: undefined })],
  ['older version', JSON.stringify({ ...valid, version: 0 })],
  ['newer version', JSON.stringify({ ...valid, version: 2 })],
  ['books not an object', JSON.stringify({ ...valid, books: [] })],
  ['bad book', JSON.stringify({ ...valid, books: { x: { title: 1, authors: '', pages: 1 } } })],
  ['short row', JSON.stringify({ ...valid, pageStats: [['md5-a', 1, 1000, 30]] })],
  ['negative duration', JSON.stringify({ ...valid, pageStats: [['md5-a', 1, 1000, -1, 10]] })],
  ['empty md5', JSON.stringify({ ...valid, pageStats: [['', 1, 1000, 30, 10]] })],
];

describe('statistics snapshot validation', () => {
  let db: DatabaseService | null = null;

  afterEach(async () => {
    await db?.close();
    db = null;
  });

  it('accepts the current version', () => {
    expect(parseStatisticsSnapshot(JSON.stringify(valid)).ok).toBe(true);
  });

  it.each(invalidTexts)('rejects %s', (_label, text) => {
    expect(parseStatisticsSnapshot(text).ok).toBe(false);
  });

  it.each(invalidTexts)('sync neither imports nor overwrites a remote with %s', async (_l, text) => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    const id = await stats.upsertBook({ bookMd5: 'md5-local', title: 'L', authors: '' });
    await stats.insertPageEvent(id, { page: 1, startTime: 5, duration: 9, totalPages: 3 });
    let puts = 0;
    const client = {
      get: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ etag: '"e1"' }),
        data: new TextEncoder().encode(text).buffer as ArrayBuffer,
      }),
      put: async () => {
        puts += 1;
        return { ok: true, status: 201, headers: new Headers() };
      },
    };
    const result = await syncStatisticsWithWebDav(client, stats);
    expect(result.status).toBe('failed');
    expect(puts).toBe(0);
    expect(await stats.getBookByMd5('md5-a')).toBeNull();
  });
});
