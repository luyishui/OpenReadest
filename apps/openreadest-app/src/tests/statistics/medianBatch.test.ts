import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  MEDIAN_PAGE_THRESHOLD,
  MEDIAN_PAGE_WINDOW,
  getMedianPageDurationsByMd5,
} from '@/services/statistics/statisticsQueries';
import type { DatabaseService } from '@/types/database';

describe('getMedianPageDurationsByMd5 (library batch)', () => {
  let db: DatabaseService;
  let stats: StatisticsDb;

  const book = (md5: string) => stats.upsertBook({ bookMd5: md5, title: 'T ' + md5, authors: 'A' });
  const events = async (id: number, durations: number[], start = 1_000_000) => {
    for (let i = 0; i < durations.length; i++) {
      await stats.insertPageEvent(id, {
        page: i + 1,
        startTime: start + i * 200,
        duration: durations[i]!,
        totalPages: 100,
      });
    }
  };

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    stats = StatisticsDb.from(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it('answers N books with one query and matches the per-book median', async () => {
    const a = await book('a');
    const b = await book('b');
    const c = await book('c');
    await events(a, [10, 20, 30, 40, 50]);
    await events(b, [5, 5, 7, 9, 100, 100]);
    await events(c, [1, 2, 3]); // below threshold
    const select = vi.spyOn(db, 'select');
    const medians = await getMedianPageDurationsByMd5(db, ['a', 'b', 'c', 'missing']);
    expect(select).toHaveBeenCalledTimes(1);
    expect(medians).toEqual(
      new Map([
        ['a', 30],
        ['b', 8],
      ]),
    );
    select.mockRestore();
    expect(medians.get('a')).toBe(await stats.getMedianPageDurationSecs(a));
    expect(medians.get('b')).toBe(await stats.getMedianPageDurationSecs(b));
    expect(MEDIAN_PAGE_THRESHOLD).toBe(5);
  });

  it('samples only the newest MEDIAN_PAGE_WINDOW events per book', async () => {
    const a = await book('a');
    // 20 old slow events, then 50 newer fast ones: the old ones fall out of the window.
    await events(a, new Array(20).fill(500), 1_000_000);
    await events(a, new Array(MEDIAN_PAGE_WINDOW).fill(10), 2_000_000);
    const medians = await getMedianPageDurationsByMd5(db, ['a']);
    expect(medians.get('a')).toBe(10);
  });

  it('runs no query for an empty library', async () => {
    const select = vi.spyOn(db, 'select');
    expect(await getMedianPageDurationsByMd5(db, [])).toEqual(new Map());
    expect(select).not.toHaveBeenCalled();
  });

  it('windows in SQL: at most MEDIAN_PAGE_WINDOW rows per book leave the db', async () => {
    const a = await book('a');
    const b = await book('b');
    await events(a, new Array(20).fill(500), 1_000_000);
    await events(a, new Array(MEDIAN_PAGE_WINDOW).fill(10), 2_000_000);
    await events(b, new Array(15).fill(900), 1_000_000);
    await events(b, new Array(MEDIAN_PAGE_WINDOW + 10).fill(7), 3_000_000);
    const select = vi.spyOn(db, 'select');
    const medians = await getMedianPageDurationsByMd5(db, ['a', 'b']);
    expect(select).toHaveBeenCalledTimes(1);
    const rows = (await select.mock.results[0]!.value) as unknown[];
    expect(rows).toHaveLength(2 * MEDIAN_PAGE_WINDOW);
    expect(medians).toEqual(
      new Map([
        ['a', 10],
        ['b', 7],
      ]),
    );
  });

  it('chunks large libraries at 499 hashes (500 bound parameters)', async () => {
    const select = vi.spyOn(db, 'select');
    const hashes = Array.from({ length: 500 }, (_, i) => 'h' + i);
    expect(await getMedianPageDurationsByMd5(db, hashes)).toEqual(new Map());
    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[0]![1]).toHaveLength(500);
    expect(select.mock.calls[1]![1]).toEqual(['h499', MEDIAN_PAGE_WINDOW]);
  });

  it('pools duplicate-md5 book rows into one newest-first window', async () => {
    const dupRow = async (title: string) =>
      Number(
        (
          await db.execute(
            'INSERT INTO book (title, authors, md5, notes, last_open, highlights, pages, total_read_time, total_read_pages) ' +
              'VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)',
            [title, 'A', 'dup'],
          )
        ).lastInsertId,
      );
    const first = await dupRow('Old title');
    const second = await dupRow('New title');
    // The first row (what getBookByMd5 LIMIT 1 returns) holds the older slow
    // events; the newest 50 of the 60 pooled are 30 fast + 20 slow.
    await events(first, new Array(30).fill(40), 1_000_000);
    await events(second, new Array(30).fill(20), 2_000_000);
    expect(await stats.getMedianPageDurationSecs(first)).toBe(40);
    expect((await getMedianPageDurationsByMd5(db, ['dup'])).get('dup')).toBe(20);
  });

  it('uses the book_md5 index', async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'book_md5'",
    );
    expect(rows).toHaveLength(1);
  });
});
