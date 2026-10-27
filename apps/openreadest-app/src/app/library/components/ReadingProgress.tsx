import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { estimateRemainingSeconds } from '@/services/statistics/remainingTime';
import { formatDuration } from './stats/format';

interface ReadingProgressProps {
  book: Book;
  // Median seconds per page from the library's one batched stats query; null hides the estimate.
  medianPageSecs?: number | null;
}

const getProgressPercentage = (book: Book) => {
  if (!book.progress || !book.progress[1]) {
    return null;
  }
  if (book.progress && book.progress[1] === 1) {
    return 100;
  }
  const percentage = Math.round((book.progress[0] / book.progress[1]) * 100);
  return Math.max(0, Math.min(100, percentage));
};

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book, medianPageSecs = null }) => {
    const _ = useTranslation();
    const progressPercentage = useMemo(() => getProgressPercentage(book), [book]);

    if (progressPercentage === null || Number.isNaN(progressPercentage)) {
      return null;
    }

    const remainingSecs =
      progressPercentage < 100 && book.progress
        ? estimateRemainingSeconds(book.progress[1] - book.progress[0], medianPageSecs)
        : null;
    const label =
      remainingSecs !== null
        ? `${progressPercentage}% · ${_('还剩 {{duration}}', { duration: formatDuration(remainingSecs, _) })}`
        : `${progressPercentage}%`;

    return (
      <div className='text-neutral-content/70 flex min-w-0 justify-between text-xs'>
        <span className='truncate'>{label}</span>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.medianPageSecs === nextProps.medianPageSecs
    );
  },
);

ReadingProgress.displayName = 'ReadingProgress';

export default ReadingProgress;
