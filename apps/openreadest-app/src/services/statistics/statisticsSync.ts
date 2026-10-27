import type { WebDavResponse } from '@/services/webdav/client/types';
import { READEST_WEBDAV_SYSTEM_DIR } from '@/services/webdav/sync/paths';
import type { PageStatEvent, StatBook } from '@/types/statistics';
import type { StatisticsDb } from './statisticsDb';

// Reading statistics travel over WebDAV as one versioned JSON snapshot
// (OpenReadest/System/statistics.json), never as the raw database. The remote
// file is never trusted whole: every sync pulls it, merges it row by row into
// the local statistics.db (book upsert by md5, page rows ON CONFLICT
// duration=MAX via applyRemoteEvents), then pushes the merged local state with
// If-Match (or, without a strong ETag, after re-reading the remote just before
// the PUT), so a concurrent push from another device forces a re-pull instead
// of being overwritten.

export const STATISTICS_SNAPSHOT_FORMAT = 'openreadest-statistics';
export const STATISTICS_SNAPSHOT_VERSION = 1;
export const STATISTICS_SYNC_KEY = 'System/statistics.json';
export const REMOTE_STATISTICS_PATH = READEST_WEBDAV_SYSTEM_DIR + '/statistics.json';

/** One page_stat_data row: [bookMd5, page, startTime, duration, totalPages]. */
export type StatisticsSnapshotRow = [string, number, number, number, number];

export interface StatisticsSnapshotBook {
  title: string;
  authors: string;
  pages: number;
}

export interface StatisticsSnapshotV1 {
  format: typeof STATISTICS_SNAPSHOT_FORMAT;
  version: typeof STATISTICS_SNAPSHOT_VERSION;
  books: Record<string, StatisticsSnapshotBook>;
  pageStats: StatisticsSnapshotRow[];
}

export type StatisticsSnapshotParseResult =
  | { ok: true; snapshot: StatisticsSnapshotV1 }
  | { ok: false; error: string };

const compare = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
const isNonNegativeInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
// A title equal to the md5 (with no authors) is the placeholder written for
// events whose metadata a device never saw; an empty title comes from KOReader
// NULL columns. Neither may overwrite real metadata.
const isPlaceholderBook = (bookMd5: string, b: { title: string; authors: string }) =>
  !b.title || (b.title === bookMd5 && !b.authors);

// Deterministic: books and rows are sorted, so an unchanged database always
// serializes to the same text and a no-op sync can skip the upload.
export const buildStatisticsSnapshot = (data: {
  books: Array<StatBook & { pages: number }>;
  events: PageStatEvent[];
}): StatisticsSnapshotV1 => {
  const books = new Map<string, StatisticsSnapshotBook>();
  const sortedBooks = [...data.books].sort(
    (x, y) =>
      compare(x.bookMd5, y.bookMd5) || compare(x.title, y.title) || compare(x.authors, y.authors),
  );
  for (const b of sortedBooks) {
    // Legacy duplicate rows per md5: the first real (non-placeholder) row wins.
    const prev = books.get(b.bookMd5);
    const keepPrev =
      prev !== undefined &&
      (!isPlaceholderBook(b.bookMd5, prev) || isPlaceholderBook(b.bookMd5, b));
    if (keepPrev) continue;
    books.set(b.bookMd5, { title: b.title, authors: b.authors, pages: b.pages });
  }
  // Legacy KOReader data can hold two book rows per md5: fold duplicate keys with MAX.
  const rows = new Map<string, StatisticsSnapshotRow>();
  for (const e of data.events) {
    const key = e.bookMd5 + '\u0000' + e.page + '\u0000' + e.startTime;
    const prev = rows.get(key);
    if (!prev || e.duration > prev[3]) {
      rows.set(key, [e.bookMd5, e.page, e.startTime, e.duration, e.totalPages]);
    }
  }
  const pageStats = [...rows.values()].sort(
    (x, y) => compare(x[0], y[0]) || compare(x[2], y[2]) || compare(x[1], y[1]),
  );
  return {
    format: STATISTICS_SNAPSHOT_FORMAT,
    version: STATISTICS_SNAPSHOT_VERSION,
    books: Object.fromEntries(books),
    pageStats,
  };
};

export const serializeStatisticsSnapshot = (snapshot: StatisticsSnapshotV1): string =>
  JSON.stringify(snapshot);

const fail = (error: string): StatisticsSnapshotParseResult => ({ ok: false, error });

// Rejects anything it cannot fully validate (broken JSON, unknown format, any
// version other than the current one, a single bad record): a file we cannot
// read may be a newer client's, so callers must neither import nor overwrite it.
export const parseStatisticsSnapshot = (text: string): StatisticsSnapshotParseResult => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('阅读统计文件不是合法 JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('阅读统计文件格式无法识别');
  }
  const { format, version, books: rawBooks, pageStats: rawRows } = value as Record<string, unknown>;
  if (format !== STATISTICS_SNAPSHOT_FORMAT) return fail('阅读统计文件格式无法识别');
  if (version !== STATISTICS_SNAPSHOT_VERSION) {
    return fail('阅读统计文件版本不受支持（' + String(version) + '）');
  }
  if (
    typeof rawBooks !== 'object' ||
    rawBooks === null ||
    Array.isArray(rawBooks) ||
    !Array.isArray(rawRows)
  ) {
    return fail('阅读统计文件结构损坏');
  }
  const books = new Map<string, StatisticsSnapshotBook>();
  for (const [md5, b] of Object.entries(rawBooks)) {
    if (!md5 || typeof b !== 'object' || b === null) return fail('阅读统计书目记录损坏');
    const { title, authors, pages } = b as Record<string, unknown>;
    if (typeof title !== 'string' || typeof authors !== 'string' || !isNonNegativeInt(pages)) {
      return fail('阅读统计书目记录损坏');
    }
    books.set(md5, { title, authors, pages });
  }
  const pageStats: StatisticsSnapshotRow[] = [];
  for (const row of rawRows as unknown[]) {
    if (!Array.isArray(row) || row.length !== 5) return fail('阅读统计记录行损坏');
    const [md5, page, startTime, duration, totalPages] = row as unknown[];
    if (
      typeof md5 !== 'string' ||
      !md5 ||
      !isNonNegativeInt(page) ||
      !isNonNegativeInt(startTime) ||
      !isNonNegativeInt(duration) ||
      !isNonNegativeInt(totalPages)
    ) {
      return fail('阅读统计记录行损坏');
    }
    pageStats.push([md5, page, startTime, duration, totalPages]);
  }
  return {
    ok: true,
    snapshot: {
      format: STATISTICS_SNAPSHOT_FORMAT,
      version: STATISTICS_SNAPSHOT_VERSION,
      books: Object.fromEntries(books),
      pageStats,
    },
  };
};

export const exportStatisticsSnapshot = async (stats: StatisticsDb): Promise<StatisticsSnapshotV1> =>
  buildStatisticsSnapshot(await stats.exportAll());

// One transaction under StatisticsDb's write lock (applyRemoteEvents): books
// upsert by md5, page rows ON CONFLICT(id_book, page, start_time) keep MAX(duration).
// Only the difference from the local database is applied, so an unchanged remote
// applies nothing and a no-op sync does not hold the write lock (blocking tracker
// flushes) while rewriting every row. The local read happens outside the lock: a
// concurrent tracker write only adds rows or raises durations, so a skipped remote
// row is always already covered locally.
export const importStatisticsSnapshot = async (
  stats: StatisticsDb,
  snapshot: StatisticsSnapshotV1,
): Promise<void> => {
  const local = await stats.exportAll();
  const metaKey = (md5: string, title: string, authors: string) =>
    md5 + '\u0000' + title + '\u0000' + authors;
  const rowKey = (md5: string, page: number, startTime: number) =>
    md5 + '\u0000' + page + '\u0000' + startTime;
  const localMeta = new Set(local.books.map((b) => metaKey(b.bookMd5, b.title, b.authors)));
  const localRows = new Map<string, PageStatEvent>();
  for (const e of local.events) {
    const key = rowKey(e.bookMd5, e.page, e.startTime);
    const prev = localRows.get(key);
    if (!prev || e.duration > prev.duration) localRows.set(key, e);
  }
  const books: StatBook[] = [];
  for (const [bookMd5, b] of Object.entries(snapshot.books)) {
    if (isPlaceholderBook(bookMd5, b)) continue;
    // Some local row (legacy duplicates included) already carries this metadata.
    if (localMeta.has(metaKey(bookMd5, b.title, b.authors))) continue;
    books.push({ bookMd5, title: b.title, authors: b.authors });
  }
  const events: PageStatEvent[] = [];
  for (const [bookMd5, page, startTime, duration, totalPages] of snapshot.pageStats) {
    const have = localRows.get(rowKey(bookMd5, page, startTime));
    if (have && have.duration >= duration && have.totalPages === totalPages) continue;
    events.push({ bookMd5, page, startTime, duration, totalPages });
  }
  await stats.applyRemoteEvents(books, events);
};

export interface StatisticsSyncClient {
  get(path: string): Promise<WebDavResponse<ArrayBuffer>>;
  put(
    path: string,
    body: BodyInit,
    options?: { contentType?: string; ifMatch?: string; ifNoneMatch?: string },
  ): Promise<WebDavResponse<void>>;
}

export type StatisticsSyncResult =
  | { status: 'unchanged' }
  | { status: 'pushed'; attempts: number }
  | { status: 'failed'; error: string };

const MAX_PUSH_ATTEMPTS = 3;

// Pull, merge row by row, push. A remote file that cannot be validated is
// never imported and never overwritten (it may come from a newer client).
export const syncStatisticsWithWebDav = async (
  client: StatisticsSyncClient,
  stats: StatisticsDb,
): Promise<StatisticsSyncResult> => {
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt += 1) {
    const res = await client.get(REMOTE_STATISTICS_PATH);
    let remoteText: string | null = null;
    let ifMatch: string | undefined;
    if (res.ok) {
      // 200 with no body is a broken transfer, not an empty snapshot.
      if (!res.data || res.data.byteLength === 0) {
        return { status: 'failed', error: '远端阅读统计文件为空，未覆盖远端' };
      }
      remoteText = new TextDecoder().decode(res.data);
      // If-Match needs a strong validator; a weak one would fail every precondition.
      const etag = res.headers.get('etag')?.trim();
      ifMatch = etag && !etag.startsWith('W/') ? etag : undefined;
    } else if (res.status !== 404 && res.status !== 410) {
      const reason = res.error || String(res.status);
      return { status: 'failed', error: '读取远端阅读统计失败（' + reason + '）' };
    }
    if (remoteText !== null) {
      const parsed = parseStatisticsSnapshot(remoteText);
      if (!parsed.ok) return { status: 'failed', error: parsed.error + '，未覆盖远端' };
      await importStatisticsSnapshot(stats, parsed.snapshot);
    }
    const localText = serializeStatisticsSnapshot(await exportStatisticsSnapshot(stats));
    if (localText === remoteText) return { status: 'unchanged' };
    // Without a strong ETag the PUT below cannot be conditional. Narrow the race:
    // re-read just before writing and re-merge (counting as an attempt) if the
    // remote changed since our GET. Residual risk: a push landing between this
    // re-read and our PUT is still overwritten. Its rows are delayed, not lost:
    // they stay in that device's database and return on its next sync.
    if (remoteText !== null && ifMatch === undefined) {
      const recheck = await client.get(REMOTE_STATISTICS_PATH);
      const recheckText =
        recheck.ok && recheck.data ? new TextDecoder().decode(recheck.data) : null;
      if (recheckText !== remoteText) continue;
    }
    const put = await client.put(REMOTE_STATISTICS_PATH, new TextEncoder().encode(localText), {
      contentType: 'application/json; charset=utf-8',
      ifMatch,
      // Remote absent: create only if no other device created it meanwhile.
      ifNoneMatch: remoteText === null ? '*' : undefined,
    });
    if (put.ok) return { status: 'pushed', attempts: attempt };
    // 412: another device pushed between our GET and PUT; re-pull and merge its rows.
    if (put.status !== 412) {
      const reason = put.error || String(put.status);
      return { status: 'failed', error: '上传阅读统计失败（' + reason + '）' };
    }
  }
  return { status: 'failed', error: '阅读统计并发写入冲突，下次同步重试' };
};
