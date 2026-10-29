import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { DatabaseService } from '@/types/database';

interface MasterRow extends Record<string, unknown> {
  name: string;
  type: string;
}

async function schemaObjects(db: DatabaseService): Promise<Map<string, string>> {
  const rows = await db.select<MasterRow>(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view', 'index')",
  );
  return new Map(rows.map((r) => [r.name, r.type]));
}

describe('statistics schema migration (real turso node driver)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates the KOReader-compatible schema plus Readest tables', async () => {
    await migrate(db, getMigrations('statistics'));
    const objects = await schemaObjects(db);
    expect(objects.get('book')).toBe('table');
    expect(objects.get('page_stat_data')).toBe('table');
    expect(objects.get('page_stat')).toBe('view');
    expect(objects.get('numbers')).toBe('table');
    expect(objects.get('readest_stat_sync_state')).toBe('table');
    expect(objects.get('readest_page_ext')).toBe('table');
    expect(objects.get('readest_book_ext')).toBe('table');
    expect(objects.get('book_title_authors_md5')).toBe('index');
    expect(objects.get('page_stat_data_start_time')).toBe('index');
    expect(objects.get('book_md5')).toBe('index');
  });

  it('fills numbers with 1..1000 and sets user_version', async () => {
    await migrate(db, getMigrations('statistics'));
    const [range] = await db.select<{ c: number; lo: number; hi: number }>(
      'SELECT count(*) AS c, min(number) AS lo, max(number) AS hi FROM numbers',
    );
    expect(range).toEqual({ c: 1000, lo: 1, hi: 1000 });
    const [version] = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(version!.user_version).toBe(getMigrations('statistics').length);
  });

  it('is idempotent when run twice', async () => {
    await migrate(db, getMigrations('statistics'));
    await migrate(db, getMigrations('statistics'));
    const applied = await db.select<{ name: string }>('SELECT name FROM __migrations');
    expect(applied.map((r) => r.name)).toEqual(getMigrations('statistics').map((m) => m.name));
    const [nums] = await db.select<{ c: number }>('SELECT count(*) AS c FROM numbers');
    expect(nums!.c).toBe(1000);
  });

  it('re-applies cleanly over an existing schema (e.g. imported KOReader DB)', async () => {
    await migrate(db, getMigrations('statistics'));
    // Simulate a DB whose objects exist but whose migration bookkeeping does not.
    await db.execute('DELETE FROM __migrations');
    await db.execute('PRAGMA user_version = 0');
    await migrate(db, getMigrations('statistics'));
    const objects = await schemaObjects(db);
    expect(objects.get('page_stat')).toBe('view');
    const [nums] = await db.select<{ c: number }>('SELECT count(*) AS c FROM numbers');
    expect(nums!.c).toBe(1000);
  });

  it('page_stat view spreads a coarse page across rescaled pages', async () => {
    await migrate(db, getMigrations('statistics'));
    const { lastInsertId: bookId } = await db.execute(
      'INSERT INTO book (title, authors, md5, pages) VALUES (?, ?, ?, ?)',
      ['T', 'A', 'm', 10],
    );
    await db.execute(
      'INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (?, ?, ?, ?, ?)',
      [bookId, 1, 1000, 60, 5],
    );
    const rows = await db.select<{ page: number; duration: number }>(
      'SELECT page, duration FROM page_stat WHERE id_book = ? ORDER BY page',
      [bookId],
    );
    expect(rows).toEqual([
      { page: 1, duration: 30 },
      { page: 2, duration: 30 },
    ]);
  });
});
