import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { useReadingStatsTracker } from '@/hooks/useReadingStatsTracker';
import { useTtsStatsRecorder } from '@/hooks/useTtsStatsRecorder';
import { isTtsStatsActive } from '@/services/statistics/ttsStatsRecorder';
import type { TTSController } from '@/services/tts';

const state = vi.hoisted(() => ({
  settings: {} as object,
  appService: { openDatabase: () => {} } as object | null,
  viewStates: {} as Record<string, unknown>,
  bookData: null as unknown,
  open: null as unknown as Mock,
  isPlaying: false,
  controller: null as { state: string } | null,
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
let nowMs = T0 * 1000;
let visibility: DocumentVisibilityState = 'visible';

const fakeDb = () => ({
  upsertBook: vi.fn(async () => 7),
  insertPageEvent: vi.fn(async () => {}),
  recomputeBookTotals: vi.fn(async () => {}),
  checkpoint: vi.fn(async () => {}),
  scheduleCheckpoint: vi.fn(),
});

const setView = (pageIndex: number, isPrimary = true) => {
  state.viewStates = {
    [KEY]: {
      isPrimary,
      progress: { section: { current: 0, total: 5 }, pageinfo: { current: pageIndex, total: 300 } },
    },
  };
};

// TTSControl renders both: the visual tracker (via ReadingStatsTracker) and the recorder.
const renderReader = () =>
  renderHook(() => {
    useReadingStatsTracker(KEY);
    useTtsStatsRecorder(KEY, state.isPlaying, state.controller as TTSController | null);
  });

const setTts = (isPlaying: boolean, controller: { state: string } | null) => {
  state.isPlaying = isPlaying;
  state.controller = controller;
};

const advance = (s: number) => {
  nowMs += s * 1000;
};

const ev = (page: number, startTime: number, duration: number) => ({
  page,
  startTime,
  duration,
  totalPages: 300,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  nowMs = T0 * 1000;
  visibility = 'visible';
  state.settings = {};
  state.appService = { openDatabase: () => {} };
  state.open = vi.fn();
  state.bookData = {
    isFixedLayout: false,
    book: { hash: 'md5-a', title: 'Title A', author: 'Author A' },
  };
  setTts(false, null);
  setView(4);
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TTS reading stats with the visual tracker', () => {
  it('never records the same interval twice', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    const playing = { state: 'playing' };
    const { rerender, unmount } = renderReader();
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(10); // visual reading
    setTts(true, playing);
    rerender(); // TTS takes over: visual event closes at T0+10
    expect(isTtsStatsActive(KEY)).toBe(true);

    advance(60);
    setView(5); // TTS turns the page
    rerender();
    advance(20);
    setTts(false, playing); // pause: visual tracker resumes
    rerender();
    expect(isTtsStatsActive(KEY)).toBe(false);

    advance(10);
    unmount();

    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledTimes(4));
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(4);
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0, 10)); // visual
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0 + 10, 60)); // TTS
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(6, T0 + 70, 20)); // TTS
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(6, T0 + 90, 10)); // visual
  });

  it('records TTS while the page is hidden', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setTts(true, { state: 'playing' });
    const { unmount } = renderReader();
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(30);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    advance(30);
    unmount(); // book close while listening with the screen off
    expect(isTtsStatsActive(KEY)).toBe(false);

    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledTimes(2));
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(2);
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0, 30));
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0 + 30, 30));
  });

  it('persists and releases the takeover when TTS stops', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setTts(true, { state: 'playing' });
    const { rerender } = renderReader();
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(20);
    setTts(false, null); // handleStop / speak error
    rerender();
    expect(isTtsStatsActive(KEY)).toBe(false);
    await waitFor(() => expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0, 20)));
    expect(db.checkpoint).toHaveBeenCalled();
  });

  it('writes nothing when stats are switched off mid-playback', async () => {
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    setTts(true, { state: 'playing' });
    const { rerender, unmount } = renderReader();
    await waitFor(() => expect(state.open).toHaveBeenCalled());

    advance(30);
    state.settings = { readingStatsEnabled: false };
    rerender();
    expect(isTtsStatsActive(KEY)).toBe(false);
    advance(30);
    unmount();
    await flush();
    expect(db.upsertBook).not.toHaveBeenCalled();
    expect(db.insertPageEvent).not.toHaveBeenCalled();
    expect(db.checkpoint).not.toHaveBeenCalled();
    expect(db.scheduleCheckpoint).not.toHaveBeenCalled();
  });

  it('does not open the db when stats are disabled', async () => {
    state.settings = { readingStatsEnabled: false };
    setTts(true, { state: 'playing' });
    const { unmount } = renderReader();
    advance(30);
    unmount();
    await flush();
    expect(state.open).not.toHaveBeenCalled();
  });

  it('records only for the primary view in split view', async () => {
    setView(4, false);
    setTts(true, { state: 'playing' });
    const { unmount } = renderReader();
    expect(isTtsStatsActive(KEY)).toBe(false);
    advance(30);
    unmount();
    await flush();
    expect(state.open).not.toHaveBeenCalled();
  });

  it('resumes recording after a silent release with zero overlap', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const db = fakeDb();
    state.open.mockResolvedValue(db);
    const ctrl = { state: 'playing' };
    setTts(true, ctrl);
    const { unmount } = renderReader();
    expect(isTtsStatsActive(KEY)).toBe(true);

    ctrl.state = 'paused'; // controller silent while the UI stays playing
    advance(120);
    act(() => {
      vi.advanceTimersByTime(120_000); // silent roll 1
    });
    advance(10);
    act(() => {
      vi.advanceTimersByTime(10_000); // silent roll 2: release, visual resumes
    });
    expect(isTtsStatsActive(KEY)).toBe(false);

    ctrl.state = 'playing'; // audio back
    advance(5);
    act(() => {
      vi.advanceTimersByTime(5_000); // probe re-takes over
    });
    expect(isTtsStatsActive(KEY)).toBe(true);

    advance(20);
    unmount();
    await flush();
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(3);
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0, 120)); // TTS
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0 + 130, 5)); // visual
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0 + 135, 20)); // TTS
  });
});
