import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';

// appService must keep its identity across renders, as the real EnvContext does,
// or the hook's effect re-runs on every render.
const state = vi.hoisted(() => ({
  median: 30,
  open: null as unknown as Mock,
  medians: null as unknown as Mock,
  appService: { openDatabase: () => {} },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: state.appService }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (s: { settings: object }) => unknown) => select({ settings: {} }),
}));
vi.mock('@/services/statistics/statisticsDb', () => ({
  StatisticsDb: { open: (...args: unknown[]) => state.open(...args) },
}));
vi.mock('@/services/statistics/statisticsQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/statistics/statisticsQueries')>()),
  getMedianPageDurationsByMd5: (...args: unknown[]) => state.medians(...args),
}));

afterEach(() => {
  cleanup();
});

describe('useMedianPageDurationSecs refresh', () => {
  it('re-reads the median when the refresh key changes, not on every render', async () => {
    state.open = vi.fn(async () => ({ database: {} }));
    state.medians = vi.fn(async () => new Map([['h', state.median]]));
    const { result, rerender } = renderHook(({ k }) => useMedianPageDurationSecs('h', k), {
      initialProps: { k: 0 },
    });
    await waitFor(() => expect(result.current).toBe(30));
    rerender({ k: 0 });
    expect(state.medians).toHaveBeenCalledTimes(1);
    state.median = 45;
    rerender({ k: 1 });
    await waitFor(() => expect(result.current).toBe(45));
    expect(state.medians).toHaveBeenCalledTimes(2);
  });
});
