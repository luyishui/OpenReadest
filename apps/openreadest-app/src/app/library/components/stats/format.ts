import type { TranslationFunc } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';

// UI locale for Intl formatting; undefined (runtime default) when unset or not a valid tag.
export function uiLocale(): string | undefined {
  try {
    const locale = getLocale();
    return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0 ? locale : undefined;
  } catch {
    return undefined;
  }
}

export const formatNumber = (n: number, locale: string | undefined = uiLocale()): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);

// Duration in the design's compact form: '34 分', '5 时 12 分', '128 时', '不足 1 分'.
// Numerals follow the UI locale unless the caller passes its own fmt.
export function formatDuration(
  seconds: number,
  t: TranslationFunc,
  fmt: (n: number) => string = (n) => formatNumber(n),
): string {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  // fmt localizes the numerals (vertical zh footer); the key keeps its literal 1.
  if (totalMinutes < 1 && seconds > 0) return t('不足 1 分').replace('1', fmt(1));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return t('{{minutes}} 分', { minutes: fmt(minutes) });
  if (minutes === 0) return t('{{hours}} 时', { hours: fmt(hours) });
  return t('{{hours}} 时 {{minutes}} 分', { hours: fmt(hours), minutes: fmt(minutes) });
}

// Session / last-read timestamp: '今天 21:10', '昨天 22:05', otherwise the locale's
// short month/day plus time (local time zone, UI locale).
export function formatWhen(
  unixSeconds: number,
  nowSeconds: number,
  _: TranslationFunc,
  locale: string | undefined = uiLocale(),
): string {
  const d = new Date(unixSeconds * 1000);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
  const today = new Date(nowSeconds * 1000);
  today.setHours(0, 0, 0, 0);
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today.getTime() - dayStart.getTime()) / 86_400_000);
  if (daysAgo === 0) return _('今天') + ' ' + time;
  if (daysAgo === 1) return _('昨天') + ' ' + time;
  const date = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(d);
  return date + ' ' + time;
}

// 'YYYY-MM-DD' local date key as a local Date.
const parseDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
};

// 'YYYY-MM-DD' local date key -> the locale's short month/day axis label ('10/24').
export function shortDate(dateKey: string, locale: string | undefined = uiLocale()): string {
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(
    parseDateKey(dateKey),
  );
}

// 'YYYY-MM-DD' local date key -> the locale's medium date for tooltips ('Oct 24, 2026').
export function longDate(dateKey: string, locale: string | undefined = uiLocale()): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    parseDateKey(dateKey),
  );
}

// Heat level 0..4 of a value against the period's maximum (GitHub-style quartiles).
export function heatLevel(seconds: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (seconds <= 0 || max <= 0) return 0;
  const ratio = seconds / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}
