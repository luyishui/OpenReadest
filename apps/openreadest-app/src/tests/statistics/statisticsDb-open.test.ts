import { describe, it, expect, vi } from 'vitest';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { AppService } from '@/types/system';
import type { DatabaseService } from '@/types/database';

describe('StatisticsDb.open', () => {
  it('retries after a failed open and keeps the per-tab singleton once it succeeds', async () => {
    const fakeDb = {
      execute: vi.fn(async () => {}),
      select: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    } as unknown as DatabaseService;
    const openDatabase = vi
      .fn()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValue(fakeDb);
    const appService = { openDatabase } as unknown as AppService;

    await expect(StatisticsDb.open(appService)).rejects.toThrow('locked');

    const first = await StatisticsDb.open(appService);
    const second = await StatisticsDb.open(appService);
    expect(second).toBe(first);
    expect(first.database).toBe(fakeDb);
    expect(openDatabase).toHaveBeenCalledTimes(2);

    await first.close();
  });
});
