// Result types for the read-side statistics queries (stats panel + per-book
// detail). Times are Unix seconds; dates are local 'YYYY-MM-DD' strings in the
// time zone the query was run with.

/** Injectable clock + zone so every query buckets by the user's LOCAL day. */
export interface StatsQueryOptions {
  /** Current time, Unix seconds. */
  now: number;
  /** IANA time zone, e.g. 'Asia/Shanghai'. */
  timeZone: string;
}

export interface StatsTotals {
  todaySeconds: number;
  /** Seconds since the start of the local week (weeks start on Monday). */
  weekSeconds: number;
  totalSeconds: number;
  /** Local date of the Monday that starts the current week. */
  weekStartDate: string;
}

export interface StatsStreak {
  /** Consecutive local days ending today, or yesterday if today has no reading yet. */
  currentDays: number;
  longestDays: number;
}

export interface DailySeconds {
  date: string;
  seconds: number;
}

export interface BookRankingEntry {
  bookMd5: string;
  title: string;
  authors: string;
  totalSeconds: number;
  /** End of the latest event (start_time + duration). */
  lastReadTime: number;
  /** True when the caller's library md5 set no longer contains this book. */
  deletedFromLibrary: boolean;
}

export interface ReadingSession {
  startTime: number;
  /** End of the session's last event. */
  endTime: number;
  /** Sum of event durations (time actually spent reading). */
  durationSeconds: number;
  startPage: number;
  endPage: number;
  /** Progress gained, rounded percent (render as +N%). Never negative. */
  progressDeltaPercent: number;
}

export interface BookDetail {
  bookMd5: string;
  title: string;
  authors: string;
  totalSeconds: number;
  daysRead: number;
  sessionCount: number;
  averageSessionSeconds: number;
  firstReadTime: number;
  lastReadTime: number;
  /** Rounded percent of the latest event's page / total_pages. */
  progressPercent: number;
  /** Oldest first, ending today. */
  last30Days: DailySeconds[];
  /** Newest first. */
  sessions: ReadingSession[];
}
