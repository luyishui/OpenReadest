'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { TrackerCore } from '@/services/statistics/trackerCore';
import { isReadingStatsEnabled } from '@/services/statistics/remainingTime';
import {
  openStatsDb,
  persistStatEvents,
  type DbPromise,
} from '@/services/statistics/statsPersistence';
import {
  isTtsStatsActive,
  subscribeTtsStats,
  ttsStatsTakeoverAt,
} from '@/services/statistics/ttsStatsRecorder';
import { DEFAULT_STATS_TRACKING_CONFIG, type StatBook } from '@/types/statistics';
import type { PageInfo } from '@/types/book';

const nowSec = () => Math.floor(Date.now() / 1000);

export interface StatsPage {
  page: number; // 1-based
  total: number;
}

/**
 * The page a stats event is recorded on, in the SAME unit as Book.progress
 * (readerStore.setProgress): fixed layout counts sections, reflowable counts
 * foliate pageinfo locations. 1-based page with its matching total.
 */
export function statsPageOf(
  isFixedLayout: boolean,
  section: PageInfo | undefined,
  pageinfo: PageInfo | undefined,
): StatsPage | null {
  const info = isFixedLayout ? section : pageinfo;
  if (!info || typeof info.current !== 'number' || !(info.total > 0)) return null;
  return { page: info.current + 1, total: info.total };
}

/**
 * Records page-dwell events for the primary view of bookKey into the shared
 * statistics.db connection. No-op when reading stats are disabled, the view is
 * not primary (split view duplicates), or storage is unavailable.
 */
export function useReadingStatsTracker(bookKey: string): void {
  const { appService } = useEnv();
  const enabled = useSettingsStore((s) => isReadingStatsEnabled(s.settings));
  const isPrimary = useReaderStore((s) => s.viewStates[bookKey]?.isPrimary ?? false);
  const progress = useReaderStore((s) => s.viewStates[bookKey]?.progress ?? null);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const bookData = getBookData(bookKey);
  const book = bookData?.book;
  const bookMd5 = book?.hash;
  const title = book?.title ?? '';
  const authors = book?.author ?? '';

  const stat = statsPageOf(!!bookData?.isFixedLayout, progress?.section, progress?.pageinfo);
  // Primitive deps: pageinfo object identity churns on every relocate.
  const page = stat?.page;
  const total = stat?.total;
  const active = enabled && isPrimary && !!appService && !!bookMd5;
  // Handshake with TtsStatsRecorder: while TTS records this book, the visual
  // tracker stands down so the same interval is never counted twice.
  const ttsActive = useSyncExternalStore(
    subscribeTtsStats,
    () => isTtsStatsActive(bookKey),
    () => false,
  );

  const [core] = useState(() => new TrackerCore(DEFAULT_STATS_TRACKING_CONFIG));
  const dbRef = useRef<DbPromise | null>(null);
  const metaRef = useRef<StatBook | null>(null);
  const pageRef = useRef<StatsPage | null>(null);
  const idleRef = useRef<number | undefined>(undefined);
  // Read by the session cleanup, which runs before this render's effects: on a
  // stats toggle-off the in-progress event is discarded, never persisted.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Keep the latest book identity/page visible to timers and listeners.
  useEffect(() => {
    metaRef.current = bookMd5 ? { bookMd5, title, authors } : null;
    pageRef.current = page !== undefined && total !== undefined ? { page, total } : null;
  });

  const feedPage = () => {
    const p = pageRef.current;
    if (!dbRef.current || !p) return;
    if (isTtsStatsActive(bookKey)) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void persistStatEvents(dbRef.current, metaRef.current, core.onPage(p.page, p.total, nowSec()));
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => {
      idleRef.current = undefined;
      void persistStatEvents(dbRef.current, metaRef.current, core.onIdle(nowSec()));
    }, DEFAULT_STATS_TRACKING_CONFIG.idleTimeoutSeconds * 1000);
  };

  // Session: open the shared connection, flush on hide/pagehide, flush on close.
  useEffect(() => {
    if (!active || !appService) return;
    const dbp = openStatsDb(appService);
    dbRef.current = dbp;

    const onHidden = () => {
      window.clearTimeout(idleRef.current);
      void persistStatEvents(dbp, metaRef.current, core.onHide(nowSec()), true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHidden();
      else feedPage();
    };
    // TTS took over: close the visual event at the takeover instant itself,
    // synchronously in the registry callback, so the two timelines meet with
    // no overlap. Resuming after release is the ttsActive effect below.
    const onTtsChange = () => {
      const at = ttsStatsTakeoverAt(bookKey);
      if (at === undefined) return;
      window.clearTimeout(idleRef.current);
      void persistStatEvents(dbp, metaRef.current, core.onIdle(at));
    };
    const unsubscribeTts = subscribeTtsStats(onTtsChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHidden);
    feedPage();

    return () => {
      unsubscribeTts();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHidden);
      window.clearTimeout(idleRef.current);
      const closed = core.onClose(nowSec());
      // Unmount/book switch while enabled persists; a toggle-off writes nothing.
      if (enabledRef.current) void persistStatEvents(dbp, metaRef.current, closed, true);
      if (dbRef.current === dbp) dbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, appService, bookMd5]);

  // Page turns drive the tracker.
  useEffect(() => {
    if (!active) return;
    feedPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, page, total]);

  // TTS released: resume dwelling from now.
  useEffect(() => {
    if (!active || ttsActive) return;
    feedPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ttsActive]);
}
