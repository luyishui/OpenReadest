import type { AppService } from '@/types/system';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { FlushedEvent } from '@/services/statistics/trackerCore';
import type { StatBook } from '@/types/statistics';

export type DbPromise = Promise<StatisticsDb | null>;

// Statistics are best-effort telemetry: a failed open or write must never
// break reading or listening, or surface as an unhandled rejection.
export const persistStatEvents = (
  dbp: DbPromise | null,
  meta: StatBook | null,
  events: FlushedEvent[],
  checkpointNow = false,
): Promise<void> => {
  if (!dbp || !meta || events.length === 0) return Promise.resolve();
  return dbp
    .then(async (db) => {
      if (!db) return;
      const idBook = await db.upsertBook(meta);
      for (const e of events) await db.insertPageEvent(idBook, e);
      // Also refreshes book.pages / totals from the newest event.
      await db.recomputeBookTotals(idBook);
      // Get the WAL into statistics.db: right away when the reader is going
      // away (hidden/close), otherwise throttled. checkpoint() warns itself.
      if (checkpointNow) await db.checkpoint().catch(() => {});
      else db.scheduleCheckpoint();
    })
    .catch((err) => console.warn('[stats] failed to persist reading events:', err));
};

export const openStatsDb = (appService: AppService): DbPromise =>
  StatisticsDb.open(appService).catch((err) => {
    console.warn('[stats] statistics storage unavailable:', err);
    return null;
  });
