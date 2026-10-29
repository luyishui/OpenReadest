import { describe, it, expect, afterEach, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { CHECKPOINT_THROTTLE_MS, StatisticsDb } from '@/services/statistics/statisticsDb';
import type { DatabaseService } from '@/types/database';

const CHECKPOINT = 'PRAGMA wal_checkpoint(TRUNCATE)';

// Mimics native turso (tauri-plugin-turso): execute() rejects any statement
// that yields rows, which is exactly what wal_checkpoint does.
const nativeLikeDb = () => ({
  execute: vi.fn(async (sql: string) => {
    if (/^\s*PRAGMA\s+wal_checkpoint/i.test(sql)) {
      throw new Error('unexpected row during execution');
    }
    return { rowsAffected: 0, lastInsertId: 0 };
  }),
  select: vi.fn(async (sql: string) =>
    /wal_checkpoint/i.test(sql) ? [{ busy: 0, log: 0, checkpointed: 0 }] : [],
  ),
  batch: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
});

describe('StatisticsDb checkpoint', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checkpoints via select() on a driver whose execute() rejects row-returning PRAGMAs', async () => {
    const db = nativeLikeDb();
    const stats = StatisticsDb.from(db as unknown as DatabaseService);
    await expect(stats.checkpoint()).resolves.toBeUndefined();
    expect(db.select).toHaveBeenCalledWith(CHECKPOINT);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('close() checkpoints before closing the connection, without warning', async () => {
    const db = nativeLikeDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await StatisticsDb.from(db as unknown as DatabaseService).close();
    expect(db.select).toHaveBeenCalledWith(CHECKPOINT);
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once (never silently) and rethrows when the checkpoint fails', async () => {
    const db = nativeLikeDb();
    db.select.mockRejectedValue(new Error('disk I/O'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stats = StatisticsDb.from(db as unknown as DatabaseService);
    await expect(stats.checkpoint()).rejects.toThrow('disk I/O');
    await expect(stats.checkpoint()).rejects.toThrow('disk I/O');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('[stats]');
  });

  it('scheduleCheckpoint runs at once, then coalesces flushes to one per window', async () => {
    vi.useFakeTimers();
    const db = nativeLikeDb();
    const stats = StatisticsDb.from(db as unknown as DatabaseService);
    stats.scheduleCheckpoint();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.select).toHaveBeenCalledTimes(1);
    stats.scheduleCheckpoint();
    stats.scheduleCheckpoint();
    stats.scheduleCheckpoint();
    await vi.advanceTimersByTimeAsync(CHECKPOINT_THROTTLE_MS - 1);
    expect(db.select).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('a schedule while a checkpoint is in flight runs only one TRUNCATE', async () => {
    vi.useFakeTimers();
    const db = nativeLikeDb();
    const pending =
      Promise.withResolvers<{ busy: number; log: number; checkpointed: number }[]>();
    db.select.mockImplementationOnce(() => pending.promise);
    const stats = StatisticsDb.from(db as unknown as DatabaseService);
    const first = stats.checkpoint();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.select).toHaveBeenCalledTimes(1);
    stats.scheduleCheckpoint();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.select).toHaveBeenCalledTimes(1);
    pending.resolve([{ busy: 0, log: 0, checkpointed: 0 }]);
    await first;
    // Coalesced into one trailing checkpoint, a full window later.
    await vi.advanceTimersByTimeAsync(CHECKPOINT_THROTTLE_MS - 1);
    expect(db.select).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('works on the real turso driver and never runs inside a sync pull transaction', async () => {
    const db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('statistics'));
    const stats = StatisticsDb.from(db);
    const order: string[] = [];
    const exec = db.execute.bind(db);
    const sel = db.select.bind(db);
    vi.spyOn(db, 'execute').mockImplementation(async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') order.push(sql);
      return exec(sql, params);
    });
    vi.spyOn(db, 'select').mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql === CHECKPOINT) order.push('CHECKPOINT');
      return sel(sql, params);
    }) as typeof db.select);
    const pull = stats.applyRemoteEvents(
      [{ bookMd5: 'md5-b', title: 'B', authors: '' }],
      [{ bookMd5: 'md5-b', page: 1, startTime: 5000, duration: 30, totalPages: 100 }],
    );
    const cp = stats.checkpoint();
    await Promise.all([pull, cp]);
    expect(order).toEqual(['BEGIN', 'COMMIT', 'CHECKPOINT']);
    vi.restoreAllMocks();
    await db.close();
  });
});
