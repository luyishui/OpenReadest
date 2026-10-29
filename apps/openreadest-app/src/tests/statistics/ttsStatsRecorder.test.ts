import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  TtsStatsRecorder,
  isTtsStatsActive,
  subscribeTtsStats,
  ttsStatsTakeoverAt,
  type TtsStatsPage,
  type TtsStatsRecorderDeps,
} from '@/services/statistics/ttsStatsRecorder';
import type { AppService } from '@/types/system';

const KEY = 'book1-view1';
const T0 = 1700000000;

const fakeDb = () => ({
  upsertBook: vi.fn(async () => 7),
  insertPageEvent: vi.fn(async () => {}),
  recomputeBookTotals: vi.fn(async () => {}),
  checkpoint: vi.fn(async () => {}),
  scheduleCheckpoint: vi.fn(),
});

let now = T0;
let page: TtsStatsPage | null = null;
let enabled = true;
let audible = true;
let db = fakeDb();
let openDb: Mock;
let visibility: DocumentVisibilityState = 'visible';

const flush = () => new Promise((r) => setTimeout(r, 0));

const make = () =>
  new TtsStatsRecorder({
    bookKey: KEY,
    appService: {} as AppService,
    getMeta: () => ({ bookMd5: 'md5-a', title: 'Title A', authors: 'Author A' }),
    getPage: () => page,
    isEnabled: () => enabled,
    isAudible: () => audible,
    now: () => now,
    openDb: openDb as unknown as TtsStatsRecorderDeps['openDb'],
  });

const ev = (p: number, startTime: number, duration: number) => ({
  page: p,
  startTime,
  duration,
  totalPages: 300,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  now = T0;
  page = { page: 5, total: 300 };
  enabled = true;
  audible = true;
  visibility = 'visible';
  db = fakeDb();
  openDb = vi.fn(async () => db);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TtsStatsRecorder', () => {
  it('records play -> pause, skips paused time, checkpoints on stop', async () => {
    const r = make();
    r.play();
    expect(isTtsStatsActive(KEY)).toBe(true);
    now += 40;
    r.pause();
    expect(isTtsStatsActive(KEY)).toBe(false);
    await flush();
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(1, 7, ev(5, T0, 40));
    expect(db.scheduleCheckpoint).toHaveBeenCalledTimes(1);
    expect(db.checkpoint).not.toHaveBeenCalled();

    now += 100; // paused
    r.play();
    now += 10;
    r.stop();
    await flush();
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(5, T0 + 140, 10));
    expect(db.insertPageEvent).toHaveBeenCalledTimes(2);
    expect(db.checkpoint).toHaveBeenCalledTimes(1);
    expect(openDb).toHaveBeenCalledTimes(1);
    expect(isTtsStatsActive(KEY)).toBe(false);
  });

  it('splits events on page change', async () => {
    const r = make();
    r.play();
    now += 20;
    page = { page: 6, total: 300 };
    r.onPage();
    now += 15;
    r.stop();
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(2);
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(1, 7, ev(5, T0, 20));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(6, T0 + 20, 15));
  });

  it('drops events shorter than the 3s minimum', async () => {
    const r = make();
    r.play();
    now += 2;
    page = { page: 6, total: 300 };
    r.onPage();
    now += 2;
    r.stop();
    await flush();
    expect(db.insertPageEvent).not.toHaveBeenCalled();
  });

  it('rolls a long dwell into events capped at 120s instead of truncating', async () => {
    const r = make();
    r.play();
    now += 120;
    vi.advanceTimersByTime(120_000);
    now += 60;
    r.stop();
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(2);
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(1, 7, ev(5, T0, 120));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(5, T0 + 120, 60));
  });

  it('keeps recording while the page is hidden (screen-off listening)', async () => {
    const r = make();
    r.play();
    now += 30;
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0, 30));
    expect(db.checkpoint).toHaveBeenCalledTimes(1);
    expect(r.isPlaying).toBe(true);
    expect(isTtsStatsActive(KEY)).toBe(true);

    now += 30;
    window.dispatchEvent(new Event('pagehide'));
    now += 30;
    r.stop();
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(3);
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(5, T0 + 30, 30));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(3, 7, ev(5, T0 + 60, 30));
  });

  it('does not open the db or take over when stats are disabled', async () => {
    enabled = false;
    const r = make();
    r.play();
    now += 30;
    r.stop();
    await flush();
    expect(openDb).not.toHaveBeenCalled();
    expect(isTtsStatsActive(KEY)).toBe(false);
  });

  it('discards the in-progress event when stats are switched off mid-playback', async () => {
    const r = make();
    r.play();
    now += 30;
    enabled = false;
    r.onPage();
    expect(isTtsStatsActive(KEY)).toBe(false);
    now += 30;
    r.stop();
    await flush();
    expect(db.upsertBook).not.toHaveBeenCalled();
    expect(db.insertPageEvent).not.toHaveBeenCalled();
    expect(db.checkpoint).not.toHaveBeenCalled();
    expect(db.scheduleCheckpoint).not.toHaveBeenCalled();
  });

  it('releases the takeover when the controller stays stopped without the UI noticing', async () => {
    const r = make();
    r.play();
    audible = false;
    now += 120;
    vi.advanceTimersByTime(120_000);
    // One silent sample only flushes; recording continues.
    expect(isTtsStatsActive(KEY)).toBe(true);
    expect(r.isPlaying).toBe(true);
    now += 10;
    vi.advanceTimersByTime(10_000);
    expect(isTtsStatsActive(KEY)).toBe(false);
    expect(r.isPlaying).toBe(false);
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(1);
    expect(db.insertPageEvent).toHaveBeenCalledWith(7, ev(5, T0, 120));
  });

  it('notifies subscribers on takeover and release', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTtsStats(listener);
    const r = make();
    r.play();
    r.play(); // already active: no extra notification
    r.stop();
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('swallows write errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.upsertBook.mockRejectedValue(new Error('database not loaded'));
    const r = make();
    r.play();
    now += 10;
    expect(() => r.stop()).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalled();
    expect(isTtsStatsActive(KEY)).toBe(false);
  });

  it('keeps recording across a transient non-audible roll (block end / rate change)', async () => {
    const r = make();
    r.play();
    audible = false; // controller between stop() and the next speak
    now += 120;
    vi.advanceTimersByTime(120_000);
    expect(r.isPlaying).toBe(true);
    expect(isTtsStatsActive(KEY)).toBe(true);
    audible = true;
    now += 10;
    vi.advanceTimersByTime(10_000); // re-check finds audio again: feed resumes
    expect(isTtsStatsActive(KEY)).toBe(true);
    now += 50;
    r.stop();
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(2);
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(1, 7, ev(5, T0, 120));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(5, T0 + 130, 50));
    expect(isTtsStatsActive(KEY)).toBe(false);
  });

  it('a page change with audio between silent rolls resets the silent run', async () => {
    const r = make();
    r.play();
    audible = false;
    now += 120;
    vi.advanceTimersByTime(120_000); // silent roll 1
    audible = true;
    now += 5;
    page = { page: 6, total: 300 };
    r.onPage(); // audio confirmed: run reset, full period re-armed
    audible = false;
    now += 120;
    vi.advanceTimersByTime(120_000); // silent again: first sample of a new run
    expect(r.isPlaying).toBe(true);
    expect(isTtsStatsActive(KEY)).toBe(true);
    now += 10;
    vi.advanceTimersByTime(10_000); // persistent silence still releases
    expect(r.isPlaying).toBe(false);
    expect(isTtsStatsActive(KEY)).toBe(false);
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(2);
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(1, 7, ev(5, T0, 120));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(6, T0 + 125, 120));
  });

  it('a hidden/pagehide sample right after a silent roll does not count again', async () => {
    const r = make();
    r.play();
    audible = false;
    now += 120;
    vi.advanceTimersByTime(120_000); // silent roll 1
    now += 5;
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange')); // still silent, 5s later
    window.dispatchEvent(new Event('pagehide'));
    expect(r.isPlaying).toBe(true);
    expect(isTtsStatsActive(KEY)).toBe(true);
    audible = true;
    now += 5;
    vi.advanceTimersByTime(10_000); // recheck armed by roll 1 finds audio
    expect(r.isPlaying).toBe(true);
    now += 30;
    r.stop();
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(2);
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(1, 7, ev(5, T0, 120));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(5, T0 + 130, 30));
  });

  it('records the full time contiguously when the roll timer fires late', async () => {
    const r = make();
    r.play();
    now += 125; // timer due at 120s, runs at 125s
    vi.advanceTimersByTime(120_000);
    now += 125; // 250s total
    vi.advanceTimersByTime(120_000);
    r.stop();
    await flush();
    expect(db.insertPageEvent).toHaveBeenCalledTimes(3);
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(1, 7, ev(5, T0, 120));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(2, 7, ev(5, T0 + 120, 120));
    expect(db.insertPageEvent).toHaveBeenNthCalledWith(3, 7, ev(5, T0 + 240, 10));
  });

  it('publishes the takeover instant to subscribers synchronously', () => {
    const seen: (number | undefined)[] = [];
    const unsubscribe = subscribeTtsStats(() => seen.push(ttsStatsTakeoverAt(KEY)));
    const r = make();
    now += 7;
    r.play();
    now += 30;
    r.stop();
    unsubscribe();
    expect(seen).toEqual([T0 + 7, undefined]);
  });
});
