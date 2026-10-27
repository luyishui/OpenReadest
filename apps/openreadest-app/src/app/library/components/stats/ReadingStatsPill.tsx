import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdOutlineTimer } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { getDirFromUILanguage } from '@/utils/rtl';
import type { Book } from '@/types/book';
import type { StatsDataSource } from './statsDataSource';
import { StatsPanelContent } from './StatsPanelContent';
import { usePrefersReducedMotion } from './useReducedMotion';
import { formatDuration } from './format';

/** Container-transform duration (spec Q8: ~300ms ease-out). */
const MORPH_MS = 300;

type Phase = 'closed' | 'entering' | 'open' | 'leaving';

interface ReadingStatsPillProps {
  dataSource: StatsDataSource;
  /** md5s (Book.hash) currently in the library; books outside it render greyed. */
  libraryMd5s: ReadonlySet<string>;
  /** Library books by md5 (Book.hash) so the panel draws real covers. */
  booksByMd5?: ReadonlyMap<string, Book>;
  /** The repo's e-ink flag (viewSettings.isEink): disables the morph animation. */
  isEink: boolean;
  /** Overrides the viewport check; production leaves it undefined. */
  isMobile?: boolean;
}

/**
 * Library bottom-right pill with today's reading time. Desktop: the pill grows
 * into a 448 x min(720px, 85vh) panel anchored bottom-right (no backdrop;
 * outside click / Esc close). Mobile: the existing Dialog bottom sheet.
 */
export const ReadingStatsPill: React.FC<ReadingStatsPillProps> = ({
  dataSource,
  libraryMd5s,
  booksByMd5,
  isEink,
  isMobile: isMobileProp,
}) => {
  const _ = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const animate = !prefersReducedMotion && !isEink;
  const [phase, setPhase] = useState<Phase>('closed');
  const [todaySeconds, setTodaySeconds] = useState(0);
  const pillRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const restoreFocusRef = useRef(false);
  const wasOpenRef = useRef(false);
  const isRtl = getDirFromUILanguage() === 'rtl';
  const isMobile =
    isMobileProp ??
    (typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight < 640));

  const refreshTotals = useCallback(() => {
    dataSource
      .getTotals()
      .then((t) => setTodaySeconds(t.todaySeconds))
      .catch((e) => console.error('Failed to load reading time', e));
  }, [dataSource]);

  useEffect(() => {
    if (phase === 'closed') refreshTotals();
  }, [phase, refreshTotals]);

  // Today's time goes stale while the library stays mounted; refresh when the
  // tab becomes visible again or the window regains focus.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshTotals();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refreshTotals);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refreshTotals);
    };
  }, [refreshTotals]);

  const cancelFrame = useCallback(() => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
  }, []);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      cancelFrame();
    },
    [cancelFrame],
  );

  const open = () => {
    clearTimeout(timerRef.current);
    cancelFrame();
    if (isMobile || !animate) {
      setPhase('open');
      return;
    }
    // Mount at the pill's scale first, then grow on the next frame. Only
    // 'entering' may become 'open', so a fast close cannot flicker.
    setPhase('entering');
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = undefined;
        setPhase((p) => (p === 'entering' ? 'open' : p));
      });
    });
  };

  const close = useCallback(
    (restoreFocus: boolean) => {
      cancelFrame();
      restoreFocusRef.current = restoreFocus;
      if (isMobile || !animate) {
        setPhase('closed');
        return;
      }
      setPhase('leaving');
      timerRef.current = window.setTimeout(() => setPhase('closed'), MORPH_MS);
    },
    [animate, isMobile, cancelFrame],
  );
  // Escape and the close button hand focus back to the pill; an outside
  // pointerdown or the sheet's own dismissal leaves focus where it went.
  const closeAndRestoreFocus = useCallback(() => close(true), [close]);
  const closeWithoutFocus = useCallback(() => close(false), [close]);

  // Desktop focus management: into the panel on open; back to the pill on
  // close when requested, unless focus has already moved to another element.
  useEffect(() => {
    if (isMobile) return;
    if (phase === 'open') {
      wasOpenRef.current = true;
      panelRef.current?.focus();
    } else if (phase === 'closed' && wasOpenRef.current) {
      wasOpenRef.current = false;
      const active = document.activeElement;
      const focusMovedAway = !!active && active !== document.body && active.isConnected;
      if (restoreFocusRef.current && !focusMovedAway) pillRef.current?.focus();
      restoreFocusRef.current = false;
    }
  }, [phase, isMobile]);

  const desktopOpen = !isMobile && (phase === 'entering' || phase === 'open');
  useEffect(() => {
    if (!desktopOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (panelRef.current?.contains(target) || pillRef.current?.contains(target))) {
        return;
      }
      close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [desktopOpen, close]);

  const pillHidden = !isMobile && phase !== 'closed';

  return (
    <>
      <button
        ref={pillRef}
        type='button'
        data-testid='stats-pill'
        aria-label={_('阅读统计')}
        aria-expanded={phase !== 'closed'}
        onClick={open}
        tabIndex={pillHidden ? -1 : 0}
        aria-hidden={pillHidden || undefined}
        className={clsx(
          'fixed z-40 flex h-8 items-center gap-2 rounded-full px-3',
          'bg-base-100 text-base-content shadow-[0_2px_8px_rgba(0,0,0,0.15)]',
          'eink:border eink:border-base-content',
          // Anchor mirrors with the UI direction (the pill sits outside the panel's dir).
          isMobile ? (isRtl ? 'left-4' : 'right-4') : clsx('bottom-6', isRtl ? 'left-6' : 'right-6'),
          animate && 'transition-opacity duration-300 ease-out',
          pillHidden && 'pointer-events-none opacity-0',
        )}
        style={isMobile ? { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' } : undefined}
      >
        <MdOutlineTimer size={16} aria-hidden />
        <bdi className='text-[13px] font-medium' data-testid='stats-pill-label'>
          {_('今日 {{duration}}', { duration: formatDuration(todaySeconds, _) })}
        </bdi>
      </button>

      {!isMobile && phase !== 'closed' && (
        <div
          ref={panelRef}
          role='dialog'
          aria-modal='false'
          aria-label={_('阅读统计')}
          data-testid='stats-panel'
          tabIndex={-1}
          dir={isRtl ? 'rtl' : 'ltr'}
          data-animated={animate || undefined}
          className={clsx(
            'fixed bottom-6 z-50 flex w-[448px] flex-col overflow-hidden rounded-2xl',
            isRtl ? 'left-6 origin-bottom-left' : 'right-6 origin-bottom-right',
            'bg-base-100 shadow-[0_12px_32px_rgba(0,0,0,0.15)] outline-none',
            'dark:shadow-[0_12px_32px_rgba(0,0,0,0.4)] eink:shadow-none',
            'eink:border eink:border-base-content',
            'h-[min(720px,85vh)] max-w-[calc(100vw-48px)]',
            animate && 'transition-[transform,opacity] duration-300 ease-out',
            animate && (phase === 'open' ? 'scale-100 opacity-100' : 'scale-[0.08] opacity-0'),
          )}
        >
          <StatsPanelContent
            dataSource={dataSource}
            libraryMd5s={libraryMd5s}
            booksByMd5={booksByMd5}
            variant='desktop'
            onClose={closeAndRestoreFocus}
          />
        </div>
      )}

      {isMobile && phase === 'open' && (
        <Dialog
          id='reading-stats'
          isOpen
          snapHeight={0.92}
          onClose={closeWithoutFocus}
          header={<></>}
          contentClassName='!my-0 flex flex-col !overflow-hidden !px-0 sm:!px-0'
        >
          <StatsPanelContent
            dataSource={dataSource}
            libraryMd5s={libraryMd5s}
            booksByMd5={booksByMd5}
            variant='mobile'
            onClose={closeAndRestoreFocus}
          />
        </Dialog>
      )}
    </>
  );
};
