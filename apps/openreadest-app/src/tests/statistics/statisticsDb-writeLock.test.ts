import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { DatabaseService } from '@/types/database';

describe('StatisticsDb write lock', () => {
  let db: DatabaseService;
  let stats: StatisticsDb;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    stats = StatisticsDb.from(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it('does not roll back a local write issued while a pull is failing', async () => {
    const idA = await stats.upsertBook({ bookMd5: 'md5-a', title: 'A', authors: '' });
    const original = db.execute.bind(db);
    vi.spyOn(db, 'execute').mockImplementation(async (sql, params) => {
      if (sql.startsWith('UPDATE book SET total_read_time')) {
        // Yield so the local write below gets a chance to interleave.
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('boom');
      }
      return original(sql, params);
    });

    const pull = stats.applyRemoteEvents(
      [{ bookMd5: 'md5-b', title: 'B', authors: '' }],
      [{ bookMd5: 'md5-b', page: 1, startTime: 5000, duration: 30, totalPages: 100 }],
    );
    const local = stats.insertPageEvent(idA, { page: 7, startTime: 6000, duration: 40, totalPages: 100 });
    await expect(pull).rejects.toThrow('boom');
    await local;
    vi.restoreAllMocks();

    const rowsA = await db.select<{ page: number }>('SELECT page FROM page_stat_data WHERE id_book = ?', [idA]);
    expect(rowsA.map((r) => Number(r.page))).toEqual([7]);
    expect(await db.select('SELECT id FROM book WHERE md5 = ?', ['md5-b'])).toEqual([]);
  });

  it('runs a local write queued behind a successful pull after it commits', async () => {
    const idA = await stats.upsertBook({ bookMd5: 'md5-a', title: 'A', authors: '' });
    const pull = stats.applyRemoteEvents(
      [],
      [{ bookMd5: 'md5-a', page: 1, startTime: 5000, duration: 30, totalPages: 100 }],
    );
    const local = stats.insertPageEvent(idA, { page: 2, startTime: 6000, duration: 40, totalPages: 100 });
    await Promise.all([pull, local]);
    const rows = await db.select<{ page: number }>(
      'SELECT page FROM page_stat_data WHERE id_book = ? ORDER BY start_time',
      [idA],
    );
    expect(rows.map((r) => Number(r.page))).toEqual([1, 2]);
  });
});
