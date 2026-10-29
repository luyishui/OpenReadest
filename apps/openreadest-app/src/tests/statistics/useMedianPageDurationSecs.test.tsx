import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';
import type * as StatisticsQueries from '@/services/statistics/statisticsQueries';

const state = vi.hoisted(() => ({
  settings: {} as object,
  appService: { openDatabase: () => {} } as object | null,
  open: null as unknown as Mock,
  medians: null as unknown as Mock,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: state.appService }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (s: { settings: object }) => unknown) =>
    select({ settings: state.settings }),
}));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: (...args: unknown[]) => state.open(...args) },
}));
vi.mock('@/services/statistics/statisticsQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof StatisticsQueries>()),
  getMedianPageDurationsByMd5: (...args: unknown[]) => state.medians(...args),
}));

const fakeStats = () => ({ database: { id: 'stats-db' } });
const mediansFor = (entries: Record<string, number>) =>
  vi.fn(async (_db: unknown, hashes: string[]) => {
    const out = new Map<string, number>();
    for (const h of hashes) if (entries[h] !== undefined) out.set(h, entries[h]!);
    return out;
  });

beforeEach(() => {
  state.settings = {};
  state.appService = { openDatabase: () => {} };
  state.open = vi.fn();
  state.medians = mediansFor({});
});

afterEach(() => {
  cleanup();
});

describe('useMedianPageDurationSecs', () => {
  it('reads the library batch median for the hash on the shared connection', async () => {
    const stats = fakeStats();
    state.open.mockResolvedValue(stats);
    state.medians = mediansFor({ 'hash-a': 42 });
    const { result } = renderHook(() => useMedianPageDurationSecs('hash-a'));
    await waitFor(() => expect(result.current).toBe(42));
    expect(state.open).toHaveBeenCalledWith(state.appService);
    // Same query and md5 pooling as the library grid.
    expect(state.medians).toHaveBeenCalledWith(stats.database, ['hash-a']);
  });

  it('is null when the book has too little data or no stats row', async () => {
    state.open.mockResolvedValue(fakeStats());
    const { result } = renderHook(() => useMedianPageDurationSecs('hash-a'));
    await waitFor(() => expect(state.medians).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });

  it('is null when stats storage is unavailable', async () => {
    state.open.mockRejectedValue(new Error('no OPFS'));
    const { result } = renderHook(() => useMedianPageDurationSecs('hash-a'));
    await waitFor(() => expect(state.open).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(state.medians).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('does not open the db when reading stats are disabled', async () => {
    state.settings = { readingStatsEnabled: false };
    const { result } = renderHook(() => useMedianPageDurationSecs('hash-a'));
    await new Promise((r) => setTimeout(r, 0));
    expect(state.open).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('does not open the db without a book hash or app service', async () => {
    const { result } = renderHook(() => useMedianPageDurationSecs(undefined));
    state.appService = null;
    renderHook(() => useMedianPageDurationSecs('hash-a'));
    await new Promise((r) => setTimeout(r, 0));
    expect(state.open).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('drops a stale median when the book changes', async () => {
    state.open.mockResolvedValue(fakeStats());
    state.medians = mediansFor({ 'hash-a': 42 });
    const { result, rerender } = renderHook(({ hash }) => useMedianPageDurationSecs(hash), {
      initialProps: { hash: 'hash-a' },
    });
    await waitFor(() => expect(result.current).toBe(42));
    rerender({ hash: 'hash-b' });
    expect(result.current).toBeNull();
  });
});
