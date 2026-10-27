import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { isReadingStatsEnabled } from '@/services/statistics/remainingTime';
import { getMedianPageDurationsByMd5 } from '@/services/statistics/statisticsQueries';

/**
 * Median seconds-per-page for a book (keyed by Book.hash = stats md5), read on
 * the shared statistics.db connection. Null while loading, when reading stats
 * are disabled or unavailable, or when the book has too little data.
 */
// refreshKey re-reads the median whenever it changes (the reader passes a coarse
// progress tick), so the pace follows the session instead of freezing at open.
export const useMedianPageDurationSecs = (
  bookHash?: string,
  refreshKey?: string | number,
): number | null => {
  const { appService } = useEnv();
  const enabled = useSettingsStore((s) => isReadingStatsEnabled(s.settings));
  const [result, setResult] = useState<{ hash: string; median: number | null } | null>(null);

  useEffect(() => {
    if (!enabled || !appService || !bookHash) return;
    let cancelled = false;
    const load = async () => {
      let median: number | null = null;
      try {
        const stats = await StatisticsDb.open(appService);
        // Same query as the library grid, so duplicate-md5 book rows pool their
        // events identically in both places.
        const medians = await getMedianPageDurationsByMd5(stats.database, [bookHash]);
        median = medians.get(bookHash) ?? null;
      } catch {
        // Stats storage unavailable (e.g. no OPFS): show no estimate.
        median = null;
      }
      if (!cancelled) setResult({ hash: bookHash, median });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, appService, bookHash, refreshKey]);

  if (!enabled || !bookHash || result?.hash !== bookHash) return null;
  return result.median;
};
