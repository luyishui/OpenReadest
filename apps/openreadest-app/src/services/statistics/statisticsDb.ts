import type { AppService } from '@/types/system';
import type { DatabaseService, DatabaseRow } from '@/types/database';
import type { PageStatEvent, StatBook } from '@/types/statistics';

interface BookRow extends DatabaseRow {
  id: number;
  title: string;
  authors: string;
  md5: string;
  total_read_time: number;
  total_read_pages: number;
  last_open: number;
  pages: number;
}

type CursorKey = 'push' | 'pull';

// Per-tab singleton open promise. OPFS permits only ONE access handle per file
// across the whole origin, so a second connect() to statistics.db throws
// NoModificationAllowedError. Every reading-stats tracker instance (and split-
// view books) must therefore share a single connection; we memoise the open
// and never thrash it.
let sharedDb: Promise<StatisticsDb> | null = null;
let lifecycleBound = false;

function bindLifecycle(): void {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;
  // Fold the WAL into the main db when the tab is backgrounded/closed: the
  // most reliable point for best-effort async OPFS work before teardown.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sharedDb) {
      void sharedDb.then((s) => s.checkpoint()).catch(() => {});
    }
  });
}

// Native turso keeps committed pages in its WAL and only folds them into
// statistics.db on a checkpoint, so a hard kill before one loses them. Tracker
// flushes therefore schedule a checkpoint, throttled to one per window.
export const CHECKPOINT_THROTTLE_MS = 45_000;

// Typed wrapper over the KOReader-compatible statistics.db. All identity is
// keyed on book_hash (= Book.hash); the local autoincrement id_book never
// leaves this class.
export class StatisticsDb {
  // Serializes every write on the shared connection. applyRemoteEvents holds
  // it for its whole BEGIN..COMMIT, so a tracker flush (split view) can neither
  // nest a BEGIN nor land inside a pull's transaction and be discarded by its
  // ROLLBACK (tracker events are final; a lost flush is lost for good).
  private writeLock: Promise<void> = Promise.resolve();
  // Throttled post-flush checkpoint state (see scheduleCheckpoint).
  private lastCheckpointAt = 0;
  private cancelScheduledCheckpoint: (() => void) | undefined;
  private checkpointWarned = false;

  private constructor(private readonly db: DatabaseService) {}

  // Shared connection for read-side queries (statisticsQueries). Callers must use
  // this instead of opening statistics.db again (OPFS allows one handle per file).
  get database(): DatabaseService {
    return this.db;
  }

  // Production entry point: opens + migrates statistics.db (per-tab singleton).
  static async open(appService: AppService): Promise<StatisticsDb> {
    bindLifecycle();
    if (!sharedDb) {
      const pending = (async () => {
        const db = await appService.openDatabase('statistics', 'statistics.db', 'Data');
        return new StatisticsDb(db);
      })();
      sharedDb = pending;
      // A failed open must not be cached: reset so a later call retries.
      pending.catch(() => {
        if (sharedDb === pending) sharedDb = null;
      });
    }
    return sharedDb;
  }

  // Test/advanced entry point: wrap an already-migrated DatabaseService.
  static from(db: DatabaseService): StatisticsDb {
    return new StatisticsDb(db);
  }

  // Fold the WAL into the main db file and truncate it. The Turso engine does
  // NOT implement PRAGMA wal_autocheckpoint, so this is the only way pages
  // reach statistics.db. wal_checkpoint returns a (busy, log, checkpointed)
  // row and native turso's execute() rejects any row-returning statement
  // ("unexpected row during execution"), so it must go through select().
  // Runs under the write lock so it never lands inside a sync pull's
  // BEGIN..COMMIT; the checkpoint itself is short. Failures are warned once
  // and rethrown so callers decide (lifecycle callers swallow).
  async checkpoint(): Promise<void> {
    this.cancelScheduledCheckpoint?.();
    this.cancelScheduledCheckpoint = undefined;
    // Stamp the start too, so a scheduleCheckpoint() while this one is in
    // flight throttles to a trailing checkpoint instead of an immediate second
    // TRUNCATE (finally re-stamps on completion).
    this.lastCheckpointAt = Date.now();
    try {
      await this.withWriteLock(() => this.db.select('PRAGMA wal_checkpoint(TRUNCATE)'));
    } catch (err) {
      if (!this.checkpointWarned) {
        this.checkpointWarned = true;
        console.warn('[stats] WAL checkpoint failed:', err);
      }
      throw err;
    } finally {
      this.lastCheckpointAt = Date.now();
    }
  }

  // Called after each tracker flush: checkpoint at most once per
  // CHECKPOINT_THROTTLE_MS (immediately when the last one is older), coalescing
  // a burst of flushes into a single trailing checkpoint.
  scheduleCheckpoint(): void {
    if (this.cancelScheduledCheckpoint !== undefined) return;
    const wait = Math.max(0, this.lastCheckpointAt + CHECKPOINT_THROTTLE_MS - Date.now());
    const timer = setTimeout(() => {
      this.cancelScheduledCheckpoint = undefined;
      void this.checkpoint().catch(() => {});
    }, wait);
    this.cancelScheduledCheckpoint = () => clearTimeout(timer);
  }

  // Checkpoint, close the underlying connection, and reset the singleton.
  async close(): Promise<void> {
    try {
      await this.checkpoint();
    } catch {
      // best-effort: a checkpoint failure must not block close
    }
    await this.db.close();
    sharedDb = null;
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLock;
    let release!: () => void;
    this.writeLock = new Promise<void>((resolve) => (release = resolve));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  upsertBook(book: StatBook): Promise<number> {
    return this.withWriteLock(() => this.upsertBookUnlocked(book));
  }

  private async upsertBookUnlocked(book: StatBook): Promise<number> {
    const existing = await this.db.select<BookRow>('SELECT id FROM book WHERE md5 = ? LIMIT 1', [
      book.bookMd5,
    ]);
    if (existing[0]) {
      // md5 is the identity; keep the latest title/authors (LWW, matches server stat_books).
      // Legacy KOReader data can hold a second row for this md5 that already carries
      // the new (title, authors): renaming this row onto it would violate
      // UNIQUE(title, authors, md5) and abort the whole import transaction, so skip.
      const id = existing[0].id;
      await this.db.execute(
        'UPDATE book SET title = ?, authors = ? WHERE id = ? AND NOT EXISTS (' +
          'SELECT 1 FROM book WHERE title = ? AND authors = ? AND md5 = ? AND id <> ?)',
        [book.title, book.authors, id, book.title, book.authors, book.bookMd5, id],
      );
      return id;
    }
    await this.db.execute(
      'INSERT INTO book (title, authors, md5, notes, last_open, highlights, pages, total_read_time, total_read_pages) ' +
        'VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0) ' +
        'ON CONFLICT(title, authors, md5) DO NOTHING',
      [book.title, book.authors, book.bookMd5],
    );
    const rows = await this.db.select<BookRow>('SELECT id FROM book WHERE md5 = ? LIMIT 1', [
      book.bookMd5,
    ]);
    return rows[0]!.id;
  }

  insertPageEvent(
    idBook: number,
    e: { page: number; startTime: number; duration: number; totalPages: number },
  ): Promise<void> {
    return this.withWriteLock(() => this.insertPageEventUnlocked(idBook, e));
  }

  private async insertPageEventUnlocked(
    idBook: number,
    e: { page: number; startTime: number; duration: number; totalPages: number },
  ): Promise<void> {
    await this.db.execute(
      'INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) ' +
        'VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id_book, page, start_time) ' +
        'DO UPDATE SET duration = max(duration, excluded.duration), total_pages = excluded.total_pages',
      [idBook, e.page, e.startTime, e.duration, e.totalPages],
    );
  }

  recomputeBookTotals(idBook: number): Promise<void> {
    return this.withWriteLock(() => this.recomputeBookTotalsUnlocked(idBook));
  }

  private async recomputeBookTotalsUnlocked(idBook: number): Promise<void> {
    await this.db.execute(
      'UPDATE book SET ' +
        'total_read_time = COALESCE((SELECT SUM(duration) FROM page_stat_data WHERE id_book = ?), 0), ' +
        'total_read_pages = COALESCE((SELECT COUNT(DISTINCT page) FROM page_stat_data WHERE id_book = ?), 0), ' +
        'last_open = COALESCE((SELECT MAX(start_time + duration) FROM page_stat_data WHERE id_book = ?), last_open), ' +
        'pages = COALESCE((SELECT total_pages FROM page_stat_data WHERE id_book = ? ORDER BY start_time DESC LIMIT 1), pages) ' +
        'WHERE id = ?',
      [idBook, idBook, idBook, idBook, idBook],
    );
  }

  // Returns the median duration of time spent on each page in seconds, or null
  // if sufficient data is not available. Reading times are skewed, so the
  // median (not the mean) gives the representative page pace.
  async getMedianPageDurationSecs(idBook: number): Promise<number | null> {
    const PAGE_THRESHOLD = 5;
    const rows = await this.db.select<{ duration: number }>(
      'SELECT duration FROM page_stat_data WHERE id_book = ? ORDER BY start_time DESC LIMIT 50',
      [idBook],
    );
    if (rows.length < PAGE_THRESHOLD) return null;
    // The query orders by recency; sort by value so the middle is the true median.
    const pageDurations = rows.map((d) => d['duration']).sort((a, b) => a - b);
    const mid = Math.floor(pageDurations.length / 2);
    return pageDurations.length % 2 !== 0
      ? (pageDurations[mid] ?? 0)
      : ((pageDurations[mid - 1] ?? 0) + (pageDurations[mid] ?? 0)) / 2;
  }

  async getBookByMd5(md5: string): Promise<BookRow | null> {
    const rows = await this.db.select<BookRow>(
      'SELECT id, title, authors, md5, total_read_time, total_read_pages, last_open, pages ' +
        'FROM book WHERE md5 = ? LIMIT 1',
      [md5],
    );
    return rows[0] ?? null;
  }

  // Ensure a book row exists for an event whose metadata record isn't in the
  // current batch (paged pull can deliver an event before its stat_books
  // record). Unlike upsertBook, this NEVER overwrites an existing real title
  // with the hash placeholder; the real record, arriving in any page, wins.
  private async ensureBookId(bookMd5: string): Promise<number> {
    const existing = await this.db.select<BookRow>('SELECT id FROM book WHERE md5 = ? LIMIT 1', [
      bookMd5,
    ]);
    if (existing[0]) return existing[0].id;
    return this.upsertBookUnlocked({ bookMd5, title: bookMd5, authors: '' });
  }

  // Events with start_time > cursor, joined to their md5, for pushing.
  async getEventsForPush(
    sinceStartTime: number,
  ): Promise<{ events: PageStatEvent[]; books: StatBook[] }> {
    const rows = await this.db.select<DatabaseRow>(
      'SELECT b.md5 AS bookMd5, b.title AS title, b.authors AS authors, ' +
        'p.page AS page, p.start_time AS startTime, p.duration AS duration, p.total_pages AS totalPages ' +
        'FROM page_stat_data p JOIN book b ON b.id = p.id_book ' +
        'WHERE p.start_time > ? ' +
        'ORDER BY p.start_time ASC',
      [sinceStartTime],
    );
    const events: PageStatEvent[] = rows.map((r) => ({
      bookMd5: String(r['bookMd5']),
      page: Number(r['page']),
      startTime: Number(r['startTime']),
      duration: Number(r['duration']),
      totalPages: Number(r['totalPages']),
    }));
    const bookMap = new Map<string, StatBook>();
    for (const r of rows) {
      const md5 = String(r['bookMd5']);
      if (!bookMap.has(md5)) {
        bookMap.set(md5, {
          bookMd5: md5,
          title: String(r['title']),
          authors: String(r['authors']),
        });
      }
    }
    return { events, books: [...bookMap.values()] };
  }

  // Full dump for the WebDAV statistics snapshot: every book row and every
  // page_stat_data row keyed by md5 (the local id_book never leaves this class).
  async exportAll(): Promise<{
    books: Array<StatBook & { pages: number }>;
    events: PageStatEvent[];
  }> {
    const bookRows = await this.db.select<BookRow>('SELECT md5, title, authors, pages FROM book');
    const rows = await this.db.select<DatabaseRow>(
      'SELECT b.md5 AS bookMd5, p.page AS page, p.start_time AS startTime, ' +
        'p.duration AS duration, p.total_pages AS totalPages ' +
        'FROM page_stat_data p JOIN book b ON b.id = p.id_book',
    );
    return {
      // KOReader-written rows may carry NULL title/authors/pages.
      books: bookRows.map((b) => ({
        bookMd5: String(b.md5),
        title: String(b.title ?? ''),
        authors: String(b.authors ?? ''),
        pages: Number(b.pages ?? 0),
      })),
      events: rows.map((r) => ({
        bookMd5: String(r['bookMd5']),
        page: Number(r['page']),
        startTime: Number(r['startTime']),
        duration: Number(r['duration']),
        totalPages: Number(r['totalPages']),
      })),
    };
  }

  async applyRemoteEvents(books: StatBook[], events: PageStatEvent[]): Promise<void> {
    if (books.length === 0 && events.length === 0) return;
    // Hold the write lock for the whole transaction: the statistics connection
    // is shared across tracker instances (split view), so a concurrent pull
    // would nest a BEGIN, and a concurrent local write would join this
    // transaction and be rolled back with it. The per-op native lock can't make
    // this multi-statement transaction atomic on its own.
    return this.withWriteLock(async () => {
      // One transaction for the whole pulled batch: a single commit instead of
      // O(rows) fsyncs, and the apply is atomic (a failed pull leaves no partial
      // state). Critical when a fresh device backfills tens of thousands of rows.
      await this.db.execute('BEGIN');
      try {
        const idByMd5 = new Map<string, number>();
        for (const b of books) idByMd5.set(b.bookMd5, await this.upsertBookUnlocked(b));
        // Books referenced only by events (no metadata record) get a placeholder row.
        const touched = new Set<number>();
        for (const e of events) {
          let id = idByMd5.get(e.bookMd5);
          if (id === undefined) {
            id = await this.ensureBookId(e.bookMd5);
            idByMd5.set(e.bookMd5, id);
          }
          await this.insertPageEventUnlocked(id, e);
          touched.add(id);
        }
        for (const id of touched) await this.recomputeBookTotalsUnlocked(id);
        await this.db.execute('COMMIT');
      } catch (err) {
        await this.db.execute('ROLLBACK');
        throw err;
      }
    });
  }

  async getCursor(key: CursorKey): Promise<number> {
    const rows = await this.db.select<{ value: number }>(
      'SELECT value FROM readest_stat_sync_state WHERE key = ?',
      [key],
    );
    return rows[0]?.value ?? 0;
  }

  setCursor(key: CursorKey, value: number): Promise<void> {
    return this.withWriteLock(() => this.setCursorUnlocked(key, value));
  }

  private async setCursorUnlocked(key: CursorKey, value: number): Promise<void> {
    await this.db.execute(
      'INSERT INTO readest_stat_sync_state (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
}
