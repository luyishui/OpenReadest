import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useReadingStatsTracker, statsPageOf } from '@/hooks/useReadingStatsTracker';

const state = vi.hoisted(() => ({
  settings: {} as object,
  appService: { openDatabase: () => {} } as object | null,
  viewStates: {} as Record<string, unknown>,
  bookData: null as unknown,
  open: null as unknown as Mock,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: state.appService }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (s: { settings: object }) => unknown) =>
    select({ settings: state.settings }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: { viewStates: Record<string, unknown> }) => unknown) =>
    select({ viewStates: state.viewStates }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => unknown }) => unknown) =>
    select({ getBookData: () => state.bookData }),
}));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: (...args: unknown[]) => state.open(...args) },
}));

const KEY = 'book1-view1';
const T0 = 1700000000;
let nowMs = 1700000000000;
let visibility: DocumentVisibilityState = 'visible';

const fakeDb = () => ({
  upsertBook: vi.fn(async () => 7),
  insertPageEvent: vi.fn(async () => {}),
  recomputeBookTotals: vi.fn(async () => {}),
  checkpoint: vi.fn(async () => {}),
  scheduleCheckpoint: vi.fn(),
});

const setView = (
  section: { current: number; total: number },
  pageinfo: { current: number; total: number },
  isPrimary = true,
) => {
  state.viewStates = { [KEY]: { isPrimary, progress: { section, pageinfo } } };
};

const setBook = (isFixedLayout: boolean) => {
  state.bookData = {
    isFixedLayout,
    book: { hash: 'md5-a', title: 'Title A', author: 'Author A' },
  };
};

const advance = (ms: number) => {
  nowMs += ms;
};

beforeEach(() => {
  nowMs = 1700000000000;
  visibility = 'visible';
  state.settings = {};
  state.appService = { openDatabase: () => {} };
  state.open = vi.fn();
  setBook(false);
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('statsPageOf', () => {
  it('uses foliate pageinfo for reflowable and sections for fixed layout, 1-based', () => {
    const section = { current: 2, total: 5 };
    const pageinfo = { current: 40, total: 300 };
    expect(statsPageOf(false, section, pageinfo)).toEqual({ page: 41, total: 300 });
    expect(statsPageOf(true, section, pageinfo)).toEqual({ page: 3, total: 5 });
    expect(statsPageOf(false, section, undefined)).toBeNull();
    expect(statsPageOf(false, section, { current: 0, total: 0 })).toBeNull();
  });
});

describe('useReadingStatsTracker', () => {
  it('records reflowable page events in pageinfo units on page turn', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setView({ current: 0, total: 5 }, { current: 9, total: 300 });
    const { rerender } = renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalledWith(state.appService));

    advance(10000);
    setView({ current: 0, total: 5 }, { current: 10, total: 300 });
    rerender();

    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledTimes(1));
    expect(db.upsertBook).toHaveBeenCalledWith({
      bookMd5: 'md5-a',
      title: 'Title A',
      authors: 'Author A',
    });
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, {
      page: 10,
      startTime: T0,
      duration: 10,
      totalPages: 300,
    });
    expect(db.recomputeBookTotals).toHaveBeenCalledWith(7);
    // A page-turn flush only schedules the throttled checkpoint.
    expect(db.scheduleCheckpoint).toHaveBeenCalledTimes(1);
    expect(db.checkpoint).not.toHaveBeenCalled();
  });

  it('records fixed-layout page events in section units', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setBook(true);
    setView({ current: 2, total: 5 }, { current: 0, total: 1 });
    const { rerender } = renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(8000);
    setView({ current: 3, total: 5 }, { current: 0, total: 1 });
    rerender();

    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledTimes(1));
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, {
      page: 3,
      startTime: T0,
      duration: 8,
      totalPages: 5,
    });
  });

  it('drops dwell shorter than the minimum event threshold', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setView({ current: 0, total: 5 }, { current: 0, total: 300 });
    const { rerender } = renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(1000);
    setView({ current: 0, total: 5 }, { current: 1, total: 300 });
    rerender();
    await new Promise((r) => setTimeout(r, 0));
    expect(db.insertPageEvent).not.toHaveBeenCalled();
  });

  it('flushes when the page becomes hidden', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setView({ current: 0, total: 5 }, { current: 4, total: 300 });
    renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(20000);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledTimes(1));
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, {
      page: 5,
      startTime: T0,
      duration: 20,
      totalPages: 300,
    });
  });

  it('flushes on pagehide', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setView({ current: 0, total: 5 }, { current: 4, total: 300 });
    renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(6000);
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledTimes(1));
  });

  it('flushes on book close (unmount)', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setView({ current: 0, total: 5 }, { current: 4, total: 300 });
    const { unmount } = renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(30000);
    unmount();
    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledTimes(1));
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, {
      page: 5,
      startTime: T0,
      duration: 30,
      totalPages: 300,
    });
  });

  it('discards the in-progress event without writing when stats are toggled off', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setView({ current: 0, total: 5 }, { current: 4, total: 300 });
    const { rerender } = renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));

    advance(30000);
    state.settings = { readingStatsEnabled: false };
    rerender();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(db.upsertBook).not.toHaveBeenCalled();
    expect(db.insertPageEvent).not.toHaveBeenCalled();
    expect(db.recomputeBookTotals).not.toHaveBeenCalled();
    expect(db.checkpoint).not.toHaveBeenCalled();
    expect(db.scheduleCheckpoint).not.toHaveBeenCalled();
  });

  it('does not open the db or write when reading stats are disabled', async () => {
    state.settings = { readingStatsEnabled: false };
    setView({ current: 0, total: 5 }, { current: 0, total: 300 });
    const { rerender, unmount } = renderHook(() => useReadingStatsTracker(KEY));
    advance(10000);
    setView({ current: 0, total: 5 }, { current: 1, total: 300 });
    rerender();
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.open).not.toHaveBeenCalled();
  });

  it('does not track a non-primary (split view) duplicate', async () => {
    setView({ current: 0, total: 5 }, { current: 0, total: 300 }, false);
    renderHook(() => useReadingStatsTracker(KEY));
    await new Promise((r) => setTimeout(r, 0));
    expect(state.open).not.toHaveBeenCalled();
  });

  it('swallows storage errors without breaking reading', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.open.mockRejectedValue(new Error('no OPFS'));
    setView({ current: 0, total: 5 }, { current: 0, total: 300 });
    const { rerender, unmount } = renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalled());
    advance(10000);
    setView({ current: 0, total: 5 }, { current: 1, total: 300 });
    expect(() => rerender()).not.toThrow();
    expect(() => unmount()).not.toThrow();
    await waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it('swallows write errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = fakeDb();
    db.upsertBook.mockRejectedValue(new Error('database not loaded'));
    state.open.mockResolvedValue(db);
    setView({ current: 0, total: 5 }, { current: 0, total: 300 });
    const { unmount } = renderHook(() => useReadingStatsTracker(KEY));
    await waitFor(() => expect(state.open).toHaveBeenCalled());
    advance(10000);
    unmount();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(db.insertPageEvent).not.toHaveBeenCalled();
  });
});
