import { MigrationEntry, SchemaType } from '../migrate';

// Migration definitions for each schema type.
//
// To add a new migration:
//   1. Append a new entry to the appropriate schema array below.
//   2. Use a date-based name: YYYYMMDDNN (NN = sequence within the day).
//   3. Never reorder or remove existing entries.
//
// To add a new schema type:
//   1. Add the type to SchemaType in migrate.ts.
//   2. Add a new key here with its migration array.
const migrations: Record<SchemaType, MigrationEntry[]> = {
  // KOReader-compatible statistics schema (book / page_stat_data / page_stat view),
  // plus Readest extension tables keyed by book hash and a sync-state table.
  statistics: [
    {
      name: '2026061501_statistics_koreader_schema',
      sql: `
        CREATE TABLE IF NOT EXISTS book (
          id integer PRIMARY KEY autoincrement,
          title text, authors text, notes integer, last_open integer,
          highlights integer, pages integer, series text, language text,
          md5 text, total_read_time integer, total_read_pages integer
        );

        CREATE UNIQUE INDEX IF NOT EXISTS book_title_authors_md5 ON book(title, authors, md5);

        CREATE TABLE IF NOT EXISTS page_stat_data (
          id_book integer,
          page integer NOT NULL DEFAULT 0,
          start_time integer NOT NULL DEFAULT 0,
          duration integer NOT NULL DEFAULT 0,
          total_pages integer NOT NULL DEFAULT 0,
          UNIQUE (id_book, page, start_time)
        );

        CREATE INDEX IF NOT EXISTS page_stat_data_start_time ON page_stat_data(start_time);

        CREATE TABLE IF NOT EXISTS numbers (number INTEGER PRIMARY KEY);

        INSERT OR IGNORE INTO numbers(number)
          SELECT h.n * 100 + t.n * 10 + o.n + 1
          FROM (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) o,
               (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) t,
               (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) h;

        -- turso ignores IF NOT EXISTS on CREATE VIEW (READEST-13), so a plain
        -- CREATE VIEW IF NOT EXISTS still throws "already exists" when the view
        -- is present (KOReader-imported stats DB, or a partially-applied run).
        -- DROP first (turso honors DROP VIEW IF EXISTS) to stay idempotent.
        DROP VIEW IF EXISTS page_stat;

        -- Same result as KOReader's page_stat view, restructured for turso: KOReader's
        -- version references the first_page/last_page aliases inside the JOIN ... ON of
        -- the same SELECT, which SQLite tolerates but turso rejects at query time
        -- ("no such column: last_page"). Computing the aliases in a derived table first
        -- and joining numbers outside it keeps the rows identical.
        CREATE VIEW page_stat AS
          SELECT P.id_book AS id_book, P.first_page + N.idx - 1 AS page, P.start_time AS start_time,
            P.duration / (P.last_page - P.first_page + 1) AS duration
          FROM (
            SELECT id_book, start_time, duration,
              ((page - 1) * pages) / total_pages + 1 AS first_page,
              max(((page - 1) * pages) / total_pages + 1, (page * pages) / total_pages) AS last_page
            FROM page_stat_data
            JOIN book ON book.id = id_book
          ) AS P
          JOIN (SELECT number AS idx FROM numbers) AS N ON N.idx <= (P.last_page - P.first_page + 1);

        CREATE TABLE IF NOT EXISTS readest_page_ext (
          book_hash text NOT NULL, page integer NOT NULL, start_time integer NOT NULL,
          ext text, PRIMARY KEY (book_hash, page, start_time)
        );

        CREATE TABLE IF NOT EXISTS readest_book_ext (
          book_hash text PRIMARY KEY, ext text
        );

        CREATE TABLE IF NOT EXISTS readest_stat_sync_state (
          key text PRIMARY KEY, value integer NOT NULL DEFAULT 0
        );
      `,
    },
    {
      // md5 is the book identity (getBookByMd5, getMedianPageDurationsByMd5), but the
      // only index on book leads with title, so every md5 lookup scanned the table.
      name: '2026102701_statistics_book_md5_index',
      sql: 'CREATE INDEX IF NOT EXISTS book_md5 ON book(md5);',
    },
  ],
};

export function getMigrations(schema: SchemaType): MigrationEntry[] {
  return migrations[schema] ?? [];
}

// PRAGMA user_version each schema stamps (see MigrateOptions.userVersion). statistics.db is
// shared with KOReader, whose statistics plugin treats any user_version below its schema
// version (20221111) as an old DB and runs upgradeDBto20201010 etc., which would break on
// our page_stat view. Stamping its version keeps the file openable by KOReader.
const schemaUserVersions: Partial<Record<SchemaType, number>> = {
  statistics: 20221111,
};

export function getSchemaUserVersion(schema: SchemaType): number | undefined {
  return schemaUserVersions[schema];
}
