import type { DatabaseService, DatabaseRow } from '@/types/database';
import type {
  BookDetail,
  BookRankingEntry,
  DailySeconds,
  ReadingSession,
  StatsQueryOptions,
  StatsStreak,
  StatsTotals,
} from '@/types/statisticsQueries';
import {
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  computeStreaks,
  dayKey,
  localDay,
  mondayWeekday,
  splitLocal,
  tzOffsetResolver,
  type TzOffsetFn,
} from './localTime';

/**
 * Adjacent events of one book share a session while the gap between them
 * (next.start - (prev.start + prev.duration)) is <= this. The tracker already
 * closes an event after 120s idle, so any gap is a pause; 10 min keeps a short
 * break (a drink, a message) inside one sitting while a real stop starts a new
 * session. A gap of exactly 600s stays in the same session.
 */
export const SESSION_GAP_SECONDS = 600;
/** Weeks start on Monday (ISO-8601, matches the zh-CN calendar). */
export const WEEK_START = 'monday';
export const HEATMAP_WEEKS = 26;
export const BOOK_DETAIL_DAYS = 30;

interface StatEvent {
  page: number;
  startTime: number;
  duration: number;
  totalPages: number;
}

async function loadEvents(db: DatabaseService, where = '', params: unknown[] = []): Promise<StatEvent[]> {
  const rows = await db.select<DatabaseRow>(
    'SELECT page, start_time, duration, total_pages FROM page_stat_data ' +
      where +
      ' ORDER BY start_time, page',
    params,
  );
  return rows.map((r) => ({
    page: Number(r['page']),
    startTime: Number(r['start_time']),
    duration: Number(r['duration']),
    totalPages: Number(r['total_pages']),
  }));
}

function secondsByDay(events: StatEvent[], offset: TzOffsetFn): Map<number, number> {
  const byDay = new Map<number, number>();
  for (const e of events) {
    splitLocal(e.startTime, e.duration, SECONDS_PER_DAY, offset, (day, s) =>
      byDay.set(day, (byDay.get(day) ?? 0) + s),
    );
  }
  return byDay;
}

function dailyRange(byDay: Map<number, number>, first: number, last: number): DailySeconds[] {
  const out: DailySeconds[] = [];
  for (let d = first; d <= last; d++) out.push({ date: dayKey(d), seconds: byDay.get(d) ?? 0 });
  return out;
}

export async function getTotals(db: DatabaseService, opts: StatsQueryOptions): Promise<StatsTotals> {
  const offset = tzOffsetResolver(opts.timeZone);
  const today = localDay(opts.now, offset);
  const weekStart = today - mondayWeekday(today);
  const events = await loadEvents(db);
  const byDay = secondsByDay(events, offset);
  let weekSeconds = 0;
  for (let d = weekStart; d <= today; d++) weekSeconds += byDay.get(d) ?? 0;
  return {
    todaySeconds: byDay.get(today) ?? 0,
    weekSeconds,
    totalSeconds: events.reduce((sum, e) => sum + e.duration, 0),
    weekStartDate: dayKey(weekStart),
  };
}

export async function getStreak(db: DatabaseService, opts: StatsQueryOptions): Promise<StatsStreak> {
  const offset = tzOffsetResolver(opts.timeZone);
  const byDay = secondsByDay(await loadEvents(db), offset);
  const days = new Set([...byDay].filter(([, s]) => s > 0).map(([d]) => d));
  return computeStreaks(days, localDay(opts.now, offset));
}

/**
 * GitHub-style grid: HEATMAP_WEEKS Monday-aligned weeks ending with the
 * current week, through today (future days of this week are omitted), so the
 * first entry is always a Monday and the length is 25 * 7 + weekday(today) + 1.
 */
export async function getDailyHeatmap(db: DatabaseService, opts: StatsQueryOptions): Promise<DailySeconds[]> {
  const offset = tzOffsetResolver(opts.timeZone);
  const today = localDay(opts.now, offset);
  const first = today - mondayWeekday(today) - (HEATMAP_WEEKS - 1) * 7;
  // Pad by 2 days: covers any UTC offset (<= 14h) plus a cross-midnight event.
  const events = await loadEvents(db, 'WHERE start_time >= ?', [(first - 2) * SECONDS_PER_DAY]);
  return dailyRange(secondsByDay(events, offset), first, today);
}

/** 24 buckets of seconds by local hour (index 0 = 00:00-00:59), all-time. */
export async function getHourDistribution(db: DatabaseService, opts: StatsQueryOptions): Promise<number[]> {
  const offset = tzOffsetResolver(opts.timeZone);
  const hours = new Array<number>(24).fill(0);
  for (const e of await loadEvents(db)) {
    splitLocal(e.startTime, e.duration, SECONDS_PER_HOUR, offset, (idx, s) => {
      hours[((idx % 24) + 24) % 24]! += s;
    });
  }
  return hours;
}

/**
 * Books by total time desc (ties: most recently read first). Stats outlive the
 * library: pass the md5s currently in the library to flag removed books with
 * deletedFromLibrary (omit it and every entry reports false).
 */
export async function getBookRanking(
  db: DatabaseService,
  libraryMd5s?: ReadonlySet<string>,
): Promise<BookRankingEntry[]> {
  const rows = await db.select<DatabaseRow>(
    'SELECT b.md5 AS md5, b.title AS title, b.authors AS authors, ' +
      'SUM(p.duration) AS total, MAX(p.start_time + p.duration) AS last ' +
      'FROM page_stat_data p JOIN book b ON b.id = p.id_book ' +
      'GROUP BY b.id ORDER BY total DESC, last DESC',
  );
  return rows.map((r) => ({
    bookMd5: String(r['md5']),
    title: String(r['title'] ?? ''),
    authors: String(r['authors'] ?? ''),
    totalSeconds: Number(r['total']),
    lastReadTime: Number(r['last']),
    deletedFromLibrary: libraryMd5s ? !libraryMd5s.has(String(r['md5'])) : false,
  }));
}

/** Fraction of the book reached at an event, 0..1 (0 when total_pages is unknown). */
function progressAt(e: StatEvent): number {
  if (!(e.totalPages > 0)) return 0;
  return Math.min(1, Math.max(0, e.page / e.totalPages));
}

/**
 * Split one book's events (sorted by start_time) into sessions on gaps larger
 * than SESSION_GAP_SECONDS. Progress delta compares page / total_pages of the
 * session's first and last events, so a repagination (total_pages change)
 * mid-session is handled by comparing fractions, not raw page numbers.
 */
export function splitSessions(events: StatEvent[]): ReadingSession[] {
  const sessions: ReadingSession[] = [];
  let group: StatEvent[] = [];
  const close = () => {
    if (group.length === 0) return;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    sessions.push({
      startTime: first.startTime,
      endTime: Math.max(...group.map((e) => e.startTime + e.duration)),
      durationSeconds: group.reduce((sum, e) => sum + e.duration, 0),
      startPage: first.page,
      endPage: last.page,
      progressDeltaPercent: Math.max(0, Math.round((progressAt(last) - progressAt(first)) * 100)),
    });
    group = [];
  };
  let prevEnd = -Infinity;
  for (const e of events) {
    if (group.length > 0 && e.startTime - prevEnd > SESSION_GAP_SECONDS) close();
    group.push(e);
    prevEnd = Math.max(prevEnd, e.startTime + e.duration);
  }
  close();
  return sessions;
}

/** Per-book detail for the panel's push-in page; null when the book has no events. */
export async function getBookDetail(
  db: DatabaseService,
  bookMd5: string,
  opts: StatsQueryOptions,
): Promise<BookDetail | null> {
  const books = await db.select<DatabaseRow>('SELECT id, title, authors FROM book WHERE md5 = ?', [bookMd5]);
  const book = books[0];
  if (!book) return null;
  const events = await loadEvents(db, 'WHERE id_book = ?', [book['id']]);
  if (events.length === 0) return null;
  const offset = tzOffsetResolver(opts.timeZone);
  const today = localDay(opts.now, offset);
  const byDay = secondsByDay(events, offset);
  const sessions = splitSessions(events);
  const totalSeconds = events.reduce((sum, e) => sum + e.duration, 0);
  const latest = events[events.length - 1]!;
  return {
    bookMd5,
    title: String(book['title'] ?? ''),
    authors: String(book['authors'] ?? ''),
    totalSeconds,
    daysRead: [...byDay.values()].filter((s) => s > 0).length,
    sessionCount: sessions.length,
    averageSessionSeconds: Math.round(totalSeconds / sessions.length),
    firstReadTime: events[0]!.startTime,
    lastReadTime: Math.max(...events.map((e) => e.startTime + e.duration)),
    progressPercent: Math.round(progressAt(latest) * 100),
    last30Days: dailyRange(byDay, today - (BOOK_DETAIL_DAYS - 1), today),
    sessions: sessions.reverse(),
  };
}

/** Most recent page events the pace median samples per book. */
export const MEDIAN_PAGE_WINDOW = 50;
/** With fewer events than this a book has no pace yet (no estimate shown). */
export const MEDIAN_PAGE_THRESHOLD = 5;
/** Hashes per statement: with the window bound too, 500 parameters per query. */
const MEDIAN_MD5_CHUNK = 499;

function medianOf(durations: number[]): number | null {
  if (durations.length < MEDIAN_PAGE_THRESHOLD) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

// Median seconds per page for every given book hash (= book.md5) in one query,
// for the library grid: same window and threshold as
// StatisticsDb.getMedianPageDurationSecs (last MEDIAN_PAGE_WINDOW events, at
// least MEDIAN_PAGE_THRESHOLD). Books without enough data are absent.
//
// Page-unit contract: page_stat_data.page must be the same unit the UI
// subtracts for pages left, i.e. the index book.progress uses
// (isFixedLayout ? section : pageinfo). The P3 tracker must record that unit,
// not renderer screen pages, or the estimate is off by their ratio.
export async function getMedianPageDurationsByMd5(
  db: DatabaseService,
  md5s: Iterable<string>,
): Promise<Map<string, number>> {
  const hashes = [...new Set(md5s)].filter(Boolean);
  const recent = new Map<string, number[]>();
  for (let i = 0; i < hashes.length; i += MEDIAN_MD5_CHUNK) {
    const chunk = hashes.slice(i, i + MEDIAN_MD5_CHUNK);
    // Windowed in SQL: only the newest MEDIAN_PAGE_WINDOW events per hash leave the db.
    const rows = await db.select<DatabaseRow>(
      'SELECT md5, duration FROM (' +
        'SELECT b.md5 AS md5, p.duration AS duration, ' +
        'ROW_NUMBER() OVER (PARTITION BY b.md5 ORDER BY p.start_time DESC) AS rn ' +
        'FROM page_stat_data p JOIN book b ON b.id = p.id_book ' +
        'WHERE b.md5 IN (' + chunk.map(() => '?').join(', ') + ')' +
        ') WHERE rn <= ?',
      [...chunk, MEDIAN_PAGE_WINDOW],
    );
    for (const row of rows) {
      const md5 = String(row['md5']);
      let durations = recent.get(md5);
      if (!durations) recent.set(md5, (durations = []));
      durations.push(Number(row['duration']));
    }
  }
  const medians = new Map<string, number>();
  for (const [md5, durations] of recent) {
    const median = medianOf(durations);
    if (median !== null) medians.set(md5, median);
  }
  return medians;
}
