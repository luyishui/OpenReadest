import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations, getSchemaUserVersion } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';

const KOREADER_VERSION = 20221111;

async function userVersion(db: DatabaseService): Promise<number> {
  const [row] = await db.select<{ user_version: number }>('PRAGMA user_version');
  return Number(row!.user_version);
}

async function tableNames(db: DatabaseService): Promise<Set<string>> {
  const rows = await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(rows.map((r) => r.name));
}

function runStats(db: DatabaseService) {
  return migrate(db, getMigrations('statistics'), { userVersion: getSchemaUserVersion('statistics') });
}

describe('statistics user_version stamp (KOReader compatibility)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('stamps KOReader schema version on a fresh database', async () => {
    expect(getSchemaUserVersion('statistics')).toBe(KOREADER_VERSION);
    await runStats(db);
    expect(await userVersion(db)).toBe(KOREADER_VERSION);
    expect((await tableNames(db)).has('readest_stat_sync_state')).toBe(true);
  });

  it('applies Readest tables to a native KOReader DB (user_version 20221111, no __migrations) and keeps its data', async () => {
    await db.execute(
      'CREATE TABLE book (id integer PRIMARY KEY autoincrement, title text, authors text, notes integer, last_open integer, highlights integer, pages integer, series text, language text, md5 text, total_read_time integer, total_read_pages integer)',
    );
    await db.execute('CREATE UNIQUE INDEX book_title_authors_md5 ON book(title, authors, md5)');
    await db.execute(
      'CREATE TABLE page_stat_data (id_book integer, page integer NOT NULL DEFAULT 0, start_time integer NOT NULL DEFAULT 0, duration integer NOT NULL DEFAULT 0, total_pages integer NOT NULL DEFAULT 0, UNIQUE (id_book, page, start_time))',
    );
    await db.execute('CREATE VIEW page_stat AS SELECT id_book, page, start_time, duration FROM page_stat_data');
    await db.execute("INSERT INTO book (title, authors, md5, pages) VALUES ('K', 'A', 'md5-k', 10)");
    await db.execute('INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 3, 1000, 42, 10)');
    await db.execute('PRAGMA user_version = ' + KOREADER_VERSION);

    await runStats(db);

    const tables = await tableNames(db);
    expect(tables.has('__migrations')).toBe(true);
    expect(tables.has('readest_stat_sync_state')).toBe(true);
    expect(tables.has('readest_page_ext')).toBe(true);
    expect(await userVersion(db)).toBe(KOREADER_VERSION);
    const rows = await db.select<{ duration: number }>('SELECT duration FROM page_stat_data WHERE id_book = 1');
    expect(rows.map((r) => Number(r.duration))).toEqual([42]);
  });

  it('re-stamps a DB created before the stamp (user_version = migration count)', async () => {
    await migrate(db, getMigrations('statistics'));
    expect(await userVersion(db)).toBe(getMigrations('statistics').length);
    await runStats(db);
    expect(await userVersion(db)).toBe(KOREADER_VERSION);
  });

  it('is idempotent and does not re-apply migrations', async () => {
    await runStats(db);
    await runStats(db);
    const applied = await db.select<{ name: string }>('SELECT name FROM __migrations');
    expect(applied.map((r) => r.name)).toEqual(getMigrations('statistics').map((m) => m.name));
    expect(await userVersion(db)).toBe(KOREADER_VERSION);
  });
});
