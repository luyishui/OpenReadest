// Local-calendar helpers for the statistics queries. Bucketing is by the
// user's LOCAL day/hour in an IANA zone, computed with Intl so non-UTC zones
// and DST work without a tz-database dependency.

export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_HOUR = 3600;

/** The zone's UTC offset in seconds at a given Unix time. */
export type TzOffsetFn = (unixSeconds: number) => number;

const offsetFnCache = new Map<string, TzOffsetFn>();

export function tzOffsetResolver(timeZone: string): TzOffsetFn {
  const cached = offsetFnCache.get(timeZone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const fn: TzOffsetFn = (t) => {
    const whole = Math.floor(t);
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(whole * 1000))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    const asUtc =
      Date.UTC(p['year']!, p['month']! - 1, p['day']!, p['hour']! % 24, p['minute']!, p['second']!) /
      1000;
    return asUtc - whole;
  };
  offsetFnCache.set(timeZone, fn);
  return fn;
}

/** Local epoch day: whole days since 1970-01-01 on the zone's wall clock. */
export function localDay(t: number, offset: TzOffsetFn): number {
  return Math.floor((t + offset(t)) / SECONDS_PER_DAY);
}

/** 'YYYY-MM-DD' for a local epoch day. */
export function dayKey(day: number): string {
  return new Date(day * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);
}

/** Monday-based weekday (0 = Monday). Epoch day 0 (1970-01-01) was a Thursday. */
export function mondayWeekday(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

/**
 * Cross-midnight rule: an event's seconds are SPLIT across every local bucket
 * (day or hour, per unit) it spans, never attributed wholly to its start.
 * E.g. 23:59:00 + 120s credits 60s to each day. add receives the local
 * bucket index (local seconds / unit) and the seconds that fall in it.
 */
export function splitLocal(
  start: number,
  duration: number,
  unit: number,
  offset: TzOffsetFn,
  add: (localIndex: number, seconds: number) => void,
): void {
  const end = start + duration;
  let cur = start;
  while (cur < end) {
    const off = offset(cur);
    const idx = Math.floor((cur + off) / unit);
    const boundary = (idx + 1) * unit - off;
    const next = boundary > cur ? Math.min(end, boundary) : end;
    add(idx, next - cur);
    cur = next;
  }
}

/**
 * Current streak counts back from today; if today has no reading yet it
 * counts back from yesterday (the streak is still alive until today ends).
 */
export function computeStreaks(
  days: Set<number>,
  today: number,
): { currentDays: number; longestDays: number } {
  let longestDays = 0;
  let run = 0;
  let prev: number | undefined;
  for (const d of [...days].sort((a, b) => a - b)) {
    run = prev !== undefined && d === prev + 1 ? run + 1 : 1;
    longestDays = Math.max(longestDays, run);
    prev = d;
  }
  let currentDays = 0;
  let d = days.has(today) ? today : today - 1;
  while (days.has(d)) {
    currentDays++;
    d--;
  }
  return { currentDays, longestDays };
}
