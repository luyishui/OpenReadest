import type { DatabaseService } from '@/types/database';
import type {
  BookDetail,
  BookRankingEntry,
  DailySeconds,
  StatsQueryOptions,
  StatsStreak,
  StatsTotals,
} from '@/types/statisticsQueries';
import {
  getBookDetail,
  getBookRanking,
  getDailyHeatmap,
  getHourDistribution,
  getStreak,
  getTotals,
} from '@/services/statistics/statisticsQueries';
import { localeWeekStart } from '@/services/statistics/localTime';
import { uiLocale } from './format';

export interface StatsOverviewData {
  totals: StatsTotals;
  streak: StatsStreak;
  // HEATMAP_WEEKS full weeks in locale week order, oldest first; days after today are future (see getDailyHeatmap).
  heatmap: DailySeconds[];
  /** 24 local-hour buckets of seconds. */
  hours: number[];
  ranking: BookRankingEntry[];
}

/**
 * Everything the stats UI reads. Components depend on this interface only, so
 * tests inject a fake and production wraps the P2 query API.
 */
export interface StatsDataSource {
  getTotals(): Promise<StatsTotals>;
  getOverview(libraryMd5s: ReadonlySet<string>): Promise<StatsOverviewData>;
  getBookDetail(bookMd5: string): Promise<BookDetail | null>;
}

export const currentQueryOptions = (): StatsQueryOptions => ({
  now: Math.floor(Date.now() / 1000),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStart: localeWeekStart(uiLocale()),
});

export function createDbStatsDataSource(
  getDb: () => Promise<DatabaseService>,
  getOptions: () => StatsQueryOptions = currentQueryOptions,
): StatsDataSource {
  return {
    async getTotals() {
      return getTotals(await getDb(), getOptions());
    },
    async getOverview(libraryMd5s) {
      const db = await getDb();
      const opts = getOptions();
      // Sequential on purpose: the statistics connection is shared and the
      // turso drivers do not promise concurrent statements on one handle.
      const totals = await getTotals(db, opts);
      const streak = await getStreak(db, opts);
      const heatmap = await getDailyHeatmap(db, opts);
      const hours = await getHourDistribution(db, opts);
      const ranking = await getBookRanking(db, libraryMd5s);
      return { totals, streak, heatmap, hours, ranking };
    },
    async getBookDetail(bookMd5) {
      return getBookDetail(await getDb(), bookMd5, getOptions());
    },
  };
}

/** Switch-gated source: null (no DB open, no pill) unless a service exists and stats are on. */
export function createGatedStatsDataSource<T>(
  service: T | null | undefined,
  enabled: boolean,
  openDb: (service: T) => Promise<DatabaseService>,
): StatsDataSource | null {
  if (!service || !enabled) return null;
  return createDbStatsDataSource(() => openDb(service));
}
