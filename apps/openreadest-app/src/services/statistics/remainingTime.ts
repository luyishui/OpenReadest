/**
 * Remaining reading time at the reader's own pace: pages left x median seconds
 * per page (StatisticsDb.getMedianPageDurationSecs). Null when there is no pace
 * yet or nothing left, so callers hide the estimate instead of guessing.
 */
export function estimateRemainingSeconds(
  pagesLeft: number,
  medianPageSecs: number | null,
): number | null {
  if (medianPageSecs === null || !(medianPageSecs > 0)) return null;
  if (!Number.isFinite(pagesLeft) || pagesLeft <= 0) return null;
  return pagesLeft * medianPageSecs;
}

/**
 * The "启用阅读统计" switch. SystemSettings.readingStatsEnabled is added by P3
 * (default on); until it exists, or while unset, stats count as enabled.
 */
export function isReadingStatsEnabled(settings: object | null | undefined): boolean {
  return (settings as { readingStatsEnabled?: boolean } | null | undefined)?.readingStatsEnabled !== false;
}
