import clsx from 'clsx';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdArrowBackIosNew, MdArrowForwardIos, MdClose } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { getDirFromUILanguage } from '@/utils/rtl';
import type { Book } from '@/types/book';
import type { BookDetail, BookRankingEntry } from '@/types/statisticsQueries';
import type { StatsDataSource, StatsOverviewData } from './statsDataSource';
import { StatsOverview } from './StatsOverview';
import { StatsBookDetail } from './StatsBookDetail';

interface StatsPanelContentProps {
  dataSource: StatsDataSource;
  libraryMd5s: ReadonlySet<string>;
  /** Library books by md5 for real covers; missing = placeholder. */
  booksByMd5?: ReadonlyMap<string, Book>;
  /** desktop = floating panel (design StatsPanel); mobile = bottom sheet body (design Sheet). */
  variant: 'desktop' | 'mobile';
  onClose: () => void;
  /** Unix seconds; injectable for tests. */
  getNow?: () => number;
}

type DetailState = {
  entry: BookRankingEntry;
  /** undefined = loading, null = no data. */
  detail: BookDetail | null | undefined;
  failed?: boolean;
};

const ICON_BUTTON = 'btn btn-ghost h-8 min-h-8 w-8 shrink-0 rounded-lg p-0';

/**
 * Header + one scroll container shared by the overview and the pushed-in book
 * detail. The overview's scrollTop is saved on push and restored on back.
 */
export const StatsPanelContent: React.FC<StatsPanelContentProps> = ({
  dataSource,
  libraryMd5s,
  booksByMd5,
  variant,
  onClose,
  getNow = () => Math.floor(Date.now() / 1000),
}) => {
  const _ = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);
  const restorePending = useRef(false);
  const [overview, setOverview] = useState<StatsOverviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const isRtl = getDirFromUILanguage() === 'rtl';

  useEffect(() => {
    let cancelled = false;
    dataSource
      .getOverview(libraryMd5s)
      .then((data) => !cancelled && setOverview(data))
      .catch((e) => {
        console.error('Failed to load reading statistics', e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, libraryMd5s]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (detail) {
      el.scrollTop = 0;
    } else if (restorePending.current) {
      restorePending.current = false;
      el.scrollTop = savedScrollTop.current;
    }
  }, [detail]);

  const openBook = (entry: BookRankingEntry) => {
    savedScrollTop.current = scrollRef.current?.scrollTop ?? 0;
    setDetail({ entry, detail: undefined });
    dataSource
      .getBookDetail(entry.bookMd5)
      .then((d) =>
        setDetail((cur) => (cur?.entry.bookMd5 === entry.bookMd5 ? { entry, detail: d } : cur)),
      )
      .catch((e) => {
        console.error('Failed to load book statistics', e);
        setDetail((cur) =>
          cur?.entry.bookMd5 === entry.bookMd5 ? { entry, detail: null, failed: true } : cur,
        );
      });
  };

  const goBack = () => {
    restorePending.current = true;
    setDetail(null);
  };

  const isMobile = variant === 'mobile';
  const title = detail ? detail.entry.title || _('无标题') : _('阅读统计');
  const closeButton = (
    <button type='button' className={ICON_BUTTON} onClick={onClose} aria-label={_('Close')}>
      <MdClose size={18} />
    </button>
  );
  const backButton = (
    <button type='button' className={ICON_BUTTON} onClick={goBack} aria-label={_('Back')}>
      {isRtl ? <MdArrowForwardIos size={16} /> : <MdArrowBackIosNew size={16} />}
    </button>
  );
  const spacer = <span className='h-8 w-8 shrink-0' aria-hidden />;

  let body: React.ReactNode;
  if (detail) {
    body =
      detail.detail === undefined ? (
        <p className='text-base-content/60 py-8 text-center text-sm'>{_('Loading...')}</p>
      ) : detail.failed ? (
        <p className='text-base-content/60 py-8 text-center text-sm'>{_('统计数据加载失败')}</p>
      ) : detail.detail === null ? (
        <p className='text-base-content/60 py-8 text-center text-sm'>{_('暂无阅读记录')}</p>
      ) : (
        <StatsBookDetail
          detail={detail.detail}
          now={getNow()}
          book={detail.entry.deletedFromLibrary ? undefined : booksByMd5?.get(detail.entry.bookMd5)}
        />
      );
  } else if (overview) {
    body = <StatsOverview data={overview} onOpenBook={openBook} booksByMd5={booksByMd5} />;
  } else {
    body = (
      <p className='text-base-content/60 py-8 text-center text-sm'>
        {failed ? _('统计数据加载失败') : _('Loading...')}
      </p>
    );
  }

  return (
    <div className='flex h-full w-full flex-col' data-testid='stats-panel-content'>
      <header
        className={clsx(
          'flex w-full shrink-0 items-center',
          isMobile ? 'h-11 gap-1 px-2' : 'h-12',
          !isMobile && (detail ? 'gap-1 px-2' : 'justify-between pl-4 pr-2'),
        )}
      >
        {isMobile ? (detail ? backButton : closeButton) : detail && backButton}
        <h2
          className={clsx(
            'text-base-content min-w-0 truncate text-base',
            isMobile ? 'flex-1 text-center font-bold' : 'font-semibold',
            !isMobile && detail && 'flex-1',
          )}
        >
          {title}
        </h2>
        {isMobile ? spacer : closeButton}
      </header>
      <div
        ref={scrollRef}
        data-testid='stats-scroll'
        className={clsx(
          'min-h-0 flex-1 overflow-y-auto',
          isMobile ? 'px-4 pb-[34px] pt-2' : 'px-4 pb-4',
        )}
      >
        {body}
      </div>
    </div>
  );
};
