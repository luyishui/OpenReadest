import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { TrackerCore } from '@/services/statistics/trackerCore';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';
import type { DatabaseService } from '@/types/database';

interface PageRow extends Record<string, unknown> {
  page: number;
  start_time: number;
  duration: number;
  total_pages: number;
}

const BOOK = { bookMd5: 'md5-a', title: 'Title A', authors: 'Author A' };

describe('StatisticsDb (real turso node driver)', () => {
  let db: DatabaseService;
  let stats: StatisticsDb;

  const pageRows = (id: number) =>
    db.select<PageRow>(
      'SELECT page, start_time, duration, total_pages FROM page_stat_data WHERE id_book = ? ORDER BY start_time, page',
      [id],
    );

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    stats = StatisticsDb.from(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts a book and page events and reads them back', async () => {
    const id = await stats.upsertBook(BOOK);
    await stats.insertPageEvent(id, { page: 1, startTime: 1000, duration: 30, totalPages: 100 });
    await stats.insertPageEvent(id, { page: 2, startTime: 1030, duration: 45, totalPages: 100 });
    await stats.recomputeBookTotals(id);
    expect(await stats.getBookByMd5('md5-a')).toMatchObject({
      id,
      title: 'Title A',
      authors: 'Author A',
      md5: 'md5-a',
      total_read_time: 75,
      total_read_pages: 2,
      last_open: 1075,
      pages: 100,
    });
    expect(await pageRows(id)).toEqual([
      { page: 1, start_time: 1000, duration: 30, total_pages: 100 },
      { page: 2, start_time: 1030, duration: 45, total_pages: 100 },
    ]);
    expect(await stats.getBookByMd5('missing')).toBeNull();
  });

  it('upsertBook keys on md5 and keeps the latest title/authors', async () => {
    const id = await stats.upsertBook(BOOK);
    const again = await stats.upsertBook({ ...BOOK, title: 'Renamed', authors: 'B' });
    expect(again).toBe(id);
    expect(await stats.getBookByMd5('md5-a')).toMatchObject({ title: 'Renamed', authors: 'B' });
    const [n] = await db.select<{ c: number }>('SELECT count(1) AS c FROM book');
    expect(n!.c).toBe(1);
  });

  it('merges re-inserted events idempotently, keeping MAX(duration)', async () => {
    const id = await stats.upsertBook(BOOK);
    const e = { page: 3, startTime: 2000, totalPages: 100 };
    await stats.insertPageEvent(id, { ...e, duration: 40 });
    await stats.insertPageEvent(id, { ...e, duration: 25 });
    await stats.insertPageEvent(id, { ...e, duration: 40 });
    expect(await pageRows(id)).toEqual([{ page: 3, start_time: 2000, duration: 40, total_pages: 100 }]);
    await stats.insertPageEvent(id, { ...e, duration: 60 });
    expect(await pageRows(id)).toEqual([{ page: 3, start_time: 2000, duration: 60, total_pages: 100 }]);
  });

  it('applyRemoteEvents is idempotent across repeated pulls', async () => {
    const events = [
      { bookMd5: 'md5-a', page: 1, startTime: 100, duration: 10, totalPages: 50 },
      { bookMd5: 'md5-b', page: 2, startTime: 200, duration: 20, totalPages: 60 },
    ];
    await stats.applyRemoteEvents([BOOK], events);
    await stats.applyRemoteEvents([BOOK], events);
    const [n] = await db.select<{ c: number }>('SELECT count(1) AS c FROM page_stat_data');
    expect(n!.c).toBe(2);
    expect(await stats.getBookByMd5('md5-a')).toMatchObject({ total_read_time: 10, pages: 50 });
    // Event-only book gets a hash placeholder title.
    expect(await stats.getBookByMd5('md5-b')).toMatchObject({ title: 'md5-b', total_read_time: 20 });
  });

  it('handles repagination: total_pages follows the latest event', async () => {
    const id = await stats.upsertBook(BOOK);
    await stats.insertPageEvent(id, { page: 5, startTime: 1000, duration: 30, totalPages: 100 });
    await stats.insertPageEvent(id, { page: 6, startTime: 1100, duration: 30, totalPages: 120 });
    await stats.recomputeBookTotals(id);
    expect(await stats.getBookByMd5('md5-a')).toMatchObject({ pages: 120, total_read_pages: 2 });
    // Re-delivered row under the new layout updates its total_pages.
    await stats.insertPageEvent(id, { page: 5, startTime: 1000, duration: 30, totalPages: 120 });
    expect((await pageRows(id)).map((r) => r.total_pages)).toEqual([120, 120]);
  });

  it('computes the median page duration over recent events', async () => {
    const id = await stats.upsertBook(BOOK);
    const samples = [
      { page: 1, startTime: 1000, duration: 10 },
      { page: 2, startTime: 1100, duration: 50 },
      { page: 3, startTime: 1200, duration: 20 },
      { page: 4, startTime: 1300, duration: 40 },
    ];
    for (const s of samples) await stats.insertPageEvent(id, { ...s, totalPages: 100 });
    expect(await stats.getMedianPageDurationSecs(id)).toBeNull();
    await stats.insertPageEvent(id, { page: 5, startTime: 1500, duration: 30, totalPages: 100 });
    expect(await stats.getMedianPageDurationSecs(id)).toBe(30);
    await stats.insertPageEvent(id, { page: 6, startTime: 1600, duration: 60, totalPages: 100 });
    expect(await stats.getMedianPageDurationSecs(id)).toBe(35);
  });

  it('persists only TrackerCore events that pass the 3s/120s/idle thresholds', async () => {
    const core = new TrackerCore(DEFAULT_STATS_TRACKING_CONFIG);
    const flushed = [
      ...core.onPage(1, 100, 1000),
      ...core.onPage(2, 100, 1002), // page 1: 2s under the 3s minimum, dropped
      ...core.onPage(3, 100, 1302), // page 2: 300s, capped at 120s
      ...core.onPage(3, 100, 1350), // same page: keeps dwelling
      ...core.onIdle(1400), // page 3: idle flush, 98s
      ...core.onIdle(1500), // paused: nothing pending
      ...core.onPage(4, 100, 2000),
      ...core.onPage(5, 100, 2003), // page 4: exactly 3s, kept
      ...core.onClose(2005), // page 5: 2s, dropped
    ];
    const id = await stats.upsertBook(BOOK);
    for (const e of flushed) await stats.insertPageEvent(id, e);
    expect(await pageRows(id)).toEqual([
      { page: 2, start_time: 1002, duration: 120, total_pages: 100 },
      { page: 3, start_time: 1302, duration: 98, total_pages: 100 },
      { page: 4, start_time: 2000, duration: 3, total_pages: 100 },
    ]);
  });
});
