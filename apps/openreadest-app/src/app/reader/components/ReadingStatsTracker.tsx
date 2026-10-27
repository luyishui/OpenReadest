'use client';

import { useReadingStatsTracker } from '@/hooks/useReadingStatsTracker';

export default function ReadingStatsTracker({ bookKey }: { bookKey: string }) {
  useReadingStatsTracker(bookKey);
  return null;
}
