import { describe, it, expect, afterEach } from 'vitest';
import { DEFAULT_WEEK_START, localeWeekStart } from '@/services/statistics/localTime';

// Engines differ: newer ones expose Intl.Locale.prototype.getWeekInfo(), older
// ones a weekInfo getter, some neither. Stub both on the prototype per test.
const proto = Intl.Locale.prototype as unknown as Record<string, unknown>;
const KEYS = ['getWeekInfo', 'weekInfo'] as const;
const saved = new Map(KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]));

function stubEngine(info: { getWeekInfo?: () => unknown; weekInfo?: unknown }) {
  Object.defineProperty(proto, 'getWeekInfo', { configurable: true, writable: true, value: info.getWeekInfo });
  Object.defineProperty(proto, 'weekInfo', { configurable: true, get: () => info.weekInfo });
}

describe('localeWeekStart fallbacks', () => {
  afterEach(() => {
    for (const k of KEYS) {
      const desc = saved.get(k);
      if (desc) Object.defineProperty(proto, k, desc);
      else delete proto[k];
    }
  });

  it('falls back to Monday when the engine has neither getWeekInfo nor weekInfo', () => {
    stubEngine({});
    expect(localeWeekStart('en-US')).toBe(1);
    expect(localeWeekStart('zh-CN')).toBe(1);
  });

  it('uses the weekInfo getter when getWeekInfo is absent', () => {
    stubEngine({ weekInfo: { firstDay: 7 } });
    expect(localeWeekStart('en-US')).toBe(7);
  });

  it('prefers getWeekInfo over weekInfo when both exist', () => {
    stubEngine({ getWeekInfo: () => ({ firstDay: 6 }), weekInfo: { firstDay: 7 } });
    expect(localeWeekStart('ar-EG')).toBe(6);
  });

  it.each([0, 8, -1, 1.5, Number.NaN, undefined])('falls back to Monday for firstDay %s', (firstDay) => {
    stubEngine({ getWeekInfo: () => ({ firstDay }) });
    expect(localeWeekStart('en-US')).toBe(1);
  });

  it('falls back to Monday when week info is missing entirely', () => {
    stubEngine({ getWeekInfo: () => undefined, weekInfo: undefined });
    expect(localeWeekStart('en-US')).toBe(1);
  });

  it.each(['xx_bad', '', undefined])('falls back to Monday for locale %j', (locale) => {
    expect(localeWeekStart(locale)).toBe(1);
  });

  it('Monday is the single default', () => {
    expect(DEFAULT_WEEK_START).toBe(1);
  });
});
