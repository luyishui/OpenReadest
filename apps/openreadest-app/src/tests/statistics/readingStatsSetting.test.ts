import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { isReadingStatsEnabled } from '@/services/statistics/remainingTime';

const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

describe('readingStatsEnabled setting', () => {
  it('defaults to on', () => {
    expect(DEFAULT_SYSTEM_SETTINGS.readingStatsEnabled).toBe(true);
    expect(isReadingStatsEnabled(DEFAULT_SYSTEM_SETTINGS)).toBe(true);
  });
});

describe('WebDAV sync call sites gate statistics on the setting', () => {
  const FLAG = 'includeStatistics: isReadingStatsEnabled(useSettingsStore.getState().settings)';

  it.each([
    '../../app/library/components/WebDavAutoSyncRunner.tsx',
    '../../app/library/components/WebDavCenterWindow.tsx',
  ])('%s passes includeStatistics to syncWebDavSelection', (rel) => {
    const text = source(rel);
    const call = text.indexOf('syncWebDavSelection(');
    expect(call).toBeGreaterThan(-1);
    const flag = text.indexOf(FLAG, call);
    expect(flag).toBeGreaterThan(call);
    // The flag sits in the selection options of that same call.
    expect(text.slice(call, flag)).not.toContain(');');
  });
});
