import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { Insets } from '@/types/misc';
import { PageInfo, TimeInfo } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { formatNumber, formatProgress } from '@/utils/progress';
import { saveViewSettings } from '@/helpers/settings';
import { formatDuration } from '@/app/library/components/stats/format';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';
import { estimateRemainingSeconds } from '@/services/statistics/remainingTime';

interface PageInfoProps {
  bookKey: string;
  section?: PageInfo;
  pageinfo?: PageInfo;
  timeinfo?: TimeInfo;
  horizontalGap: number;
  contentInsets: Insets;
  gridInsets: Insets;
}

const ProgressInfoView: React.FC<PageInfoProps> = ({
  bookKey,
  section,
  pageinfo,
  timeinfo,
  horizontalGap,
  contentInsets,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey)!;

  const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
  const isScrolled = viewSettings.scrolled;
  const isVertical = viewSettings.vertical;
  const isEink = viewSettings.isEink;
  const { progressStyle: readingProgressStyle } = viewSettings;

  const template =
    readingProgressStyle === 'fraction'
      ? isVertical
        ? '{current} · {total}'
        : '{current} / {total}'
      : '{percent}%';

  const lang = localStorage?.getItem('i18nextLng') || '';
  const localize = isVertical && lang.toLowerCase().startsWith('zh');
  const progress = bookData?.isFixedLayout ? section : pageinfo;
  const progressInfo = formatProgress(progress?.current, progress?.total, template, localize, lang);

  const timeLeft = timeinfo
    ? _('{{time}} min left in chapter', {
        time: formatNumber(Math.round(timeinfo.section), localize, lang),
      })
    : '';
  const { page = 0, pages = 0 } = view?.renderer || {};
  // Page-count keys are Trans markup in most locales ("<0>{{count}}</0><1> pages left</1>"),
  // but this footer renders plain text, so drop the <N> markers for display and aria-label.
  const pageLeft = (
    pages - 1 > page
      ? localize
        ? _('{{number}} pages left in chapter', {
            number: formatNumber(pages - page - 1, localize, lang),
          })
        : _('{{count}} pages left in chapter', {
            count: pages - page - 1,
          })
      : ''
  ).replace(/<\/?\d+>/g, '');

  // Whole-book remaining time at the reader's own median page pace; empty when
  // reading stats are off or there is too little data. Page-unit contract: the
  // median is per page_stat_data.page, which must be this same progress index
  // (isFixedLayout ? section : pageinfo). While the median is still null (fewer
  // events than the threshold, e.g. right after opening) it is re-read on every
  // page turn, so the estimate appears as soon as there is enough data; once
  // known, a coarse tick re-reads it every 20 progress units so the pace is not
  // frozen at the value from open.
  const [hasMedian, setHasMedian] = useState(false);
  const medianRefreshKey = progress
    ? hasMedian
      ? Math.floor(progress.current / 20)
      : 'page-' + String(progress.current)
    : undefined;
  const medianPageSecs = useMedianPageDurationSecs(bookData?.book?.hash, medianRefreshKey);
  if ((medianPageSecs !== null) !== hasMedian) setHasMedian(medianPageSecs !== null);
  const bookRemainingSecs = progress
    ? estimateRemainingSeconds(progress.total - progress.current - 1, medianPageSecs)
    : null;
  const bookTimeLeft =
    bookRemainingSecs !== null
      ? _('全书还剩 {{duration}}', {
          duration: formatDuration(bookRemainingSecs, _, (n) => formatNumber(n, localize, lang)),
        })
      : '';
  // The chapter toggles control only the chapter piece; the whole-book estimate
  // shows in the remaining slot whenever it exists.
  const chapterLeft = viewSettings.showRemainingTime
    ? timeLeft
    : viewSettings.showRemainingPages
      ? pageLeft
      : '';

  const [progressInfoMode, setProgressInfoMode] = useState(viewSettings.progressInfoMode);

  const cycleProgressInfoModes = () => {
    if (!viewSettings.tapToToggleFooter) return;

    const hasRemainingInfo =
      viewSettings.showRemainingTime || viewSettings.showRemainingPages || !!bookTimeLeft;
    const hasProgressInfo = viewSettings.showProgressInfo;
    const modeSequence: (typeof progressInfoMode)[] = ['all', 'remaining', 'progress', 'none'];
    const currentIndex = modeSequence.indexOf(progressInfoMode);
    for (let i = 1; i <= modeSequence.length; i++) {
      const nextIndex = (currentIndex + i) % modeSequence.length;
      const nextMode = modeSequence[nextIndex]!;

      const currentRenders = {
        remaining:
          progressInfoMode === 'all' || progressInfoMode === 'remaining' ? hasRemainingInfo : false,
        progress:
          progressInfoMode === 'all' || progressInfoMode === 'progress' ? hasProgressInfo : false,
      };

      const nextRenders = {
        remaining: nextMode === 'all' || nextMode === 'remaining' ? hasRemainingInfo : false,
        progress: nextMode === 'all' || nextMode === 'progress' ? hasProgressInfo : false,
      };

      const isDifferent =
        currentRenders.remaining !== nextRenders.remaining ||
        currentRenders.progress !== nextRenders.progress;

      if (isDifferent) {
        setProgressInfoMode(nextMode);
        return;
      }
    }

    const nextIndex = (currentIndex + 1) % modeSequence.length;
    setProgressInfoMode(modeSequence[nextIndex]!);
  };

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'progressInfoMode', progressInfoMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressInfoMode]);

  const isMobile = appService?.isMobile || window.innerWidth < 640;

  return (
    <div
      role='presentation'
      className={clsx(
        'progressinfo absolute bottom-0 flex items-center justify-between font-sans',
        isEink ? 'text-sm font-normal' : 'text-neutral-content text-xs font-extralight',
        isVertical ? 'writing-vertical-rl' : 'w-full',
        isScrolled && !isVertical && 'bg-base-100',
        isMobile ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      onClick={() => cycleProgressInfoModes()}
      aria-label={[
        progress
          ? _('On {{current}} of {{total}} page', {
              current: progress.current + 1,
              total: progress.total,
            })
          : '',
        chapterLeft,
        bookTimeLeft,
      ]
        .filter(Boolean)
        .join(', ')}
      style={
        isVertical
          ? {
              bottom: `${(contentInsets.bottom - gridInsets.bottom) * 1.5}px`,
              left: showDoubleBorder
                ? `calc(${contentInsets.left}px)`
                : `calc(${Math.max(0, contentInsets.left - 32)}px)`,
              width: showDoubleBorder ? '32px' : `${contentInsets.left}px`,
              height: `calc(100% - ${((contentInsets.top + contentInsets.bottom) / 2) * 3}px)`,
            }
          : {
              paddingInlineStart: `calc(${horizontalGap / 2}% + ${contentInsets.left / 2}px)`,
              paddingInlineEnd: `calc(${horizontalGap / 2}% + ${contentInsets.right / 2}px)`,
              paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0,
            }
      }
    >
      <div
        aria-hidden='true'
        className={clsx(
          'flex items-center justify-between',
          isVertical ? 'h-full' : 'h-[52px] w-full gap-x-2',
        )}
      >
        {(progressInfoMode === 'all' || progressInfoMode === 'remaining') &&
          (chapterLeft || bookTimeLeft) && (
            <span className={clsx('text-start', !isVertical && 'flex min-w-0 flex-1 gap-x-1')}>
              {chapterLeft ? (
                <span className={clsx(!isVertical && 'min-w-0 truncate')}>{chapterLeft}</span>
              ) : null}
              {bookTimeLeft ? (
                // Own non-shrinking span: on narrow footers the chapter text truncates first,
                // never the whole-book estimate.
                <span
                  className={clsx('book-time-left', !isVertical && 'shrink-0 whitespace-nowrap')}
                >
                  {chapterLeft ? ' · ' : ''}
                  {bookTimeLeft}
                </span>
              ) : null}
            </span>
          )}

        {(progressInfoMode === 'all' || progressInfoMode === 'progress') && (
          <>
            {viewSettings.showProgressInfo && (
              <span
                className={clsx(
                  'text-end',
                  isVertical ? 'mt-auto' : 'ms-auto min-w-0 flex-1 truncate',
                )}
              >
                {progressInfo}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ProgressInfoView;
