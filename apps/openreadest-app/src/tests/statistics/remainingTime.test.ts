import { describe, it, expect } from 'vitest';
import {
  estimateRemainingSeconds,
  isReadingStatsEnabled,
} from '@/services/statistics/remainingTime';
import { formatDuration } from '@/app/library/components/stats/format';
import type { TranslationFunc } from '@/hooks/useTranslation';

// Chinese source keys, interpolated like i18next's defaultValue path.
const t = ((key: string, opts: Record<string, string | number> = {}) =>
  key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts[name] ?? ''))) as TranslationFunc;

describe('estimateRemainingSeconds', () => {
  it('multiplies pages left by the median page pace', () => {
    expect(estimateRemainingSeconds(60, 30)).toBe(1800);
    expect(estimateRemainingSeconds(1, 12.5)).toBe(12.5);
  });

  it('returns null without a usable pace', () => {
    expect(estimateRemainingSeconds(60, null)).toBeNull();
    expect(estimateRemainingSeconds(60, 0)).toBeNull();
    expect(estimateRemainingSeconds(60, Number.NaN)).toBeNull();
  });

  it('returns null when nothing is left', () => {
    expect(estimateRemainingSeconds(0, 30)).toBeNull();
    expect(estimateRemainingSeconds(-3, 30)).toBeNull();
    expect(estimateRemainingSeconds(Number.POSITIVE_INFINITY, 30)).toBeNull();
  });
});

describe('isReadingStatsEnabled', () => {
  it('treats a missing or unset switch as on (P3 adds readingStatsEnabled, default on)', () => {
    expect(isReadingStatsEnabled(undefined)).toBe(true);
    expect(isReadingStatsEnabled(null)).toBe(true);
    expect(isReadingStatsEnabled({})).toBe(true);
    expect(isReadingStatsEnabled({ readingStatsEnabled: true })).toBe(true);
  });

  it('is off only when explicitly disabled', () => {
    expect(isReadingStatsEnabled({ readingStatsEnabled: false })).toBe(false);
  });
});

describe('remaining time formatting', () => {
  it('formats estimates in the compact design form', () => {
    expect(formatDuration(estimateRemainingSeconds(60, 30)!, t)).toBe('30 分');
    expect(formatDuration(estimateRemainingSeconds(102, 60)!, t)).toBe('1 时 42 分');
    expect(formatDuration(estimateRemainingSeconds(120, 60)!, t)).toBe('2 时');
    expect(formatDuration(estimateRemainingSeconds(1, 20)!, t)).toBe('不足 1 分');
  });
});
