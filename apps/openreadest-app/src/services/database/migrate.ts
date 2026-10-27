import { DatabaseService } from '@/types/database';

export interface MigrationEntry {
  // Migration name, e.g. "2026061501_statistics_koreader_schema"
  name: string;
  // SQL statements separated by semicolons
  sql: string;
}

// Discriminator for databases with different schemas. Add new schema types here as needed.
export type SchemaType = 'statistics';

export interface MigrateOptions {
  // Name of the tracking table. Defaults to '__migrations'.
  table?: string;
  // Fixed PRAGMA user_version to stamp instead of the migration count. Used when the
  // file is shared with another app that owns user_version (KOReader's statistics.db
  // uses its own schema version, 20221111). With a stamp, user_version cannot tell our
  // DB from the other app's DB, so pending migrations are decided by the tracking
  // table instead of the user_version fast path.
  userVersion?: number;
}

// Run pending migrations against a DatabaseService instance.
//
// Without a userVersion stamp, PRAGMA user_version is an O(1) fast path that skips
// migration checks when the database is already at the latest version, so it is cheap
// to call on every openDatabase(). With a stamp, the check is one sqlite_master lookup
// plus one small SELECT on the tracking table. Each migration runs atomically via
// batch(): the schema changes and the tracking record are committed together.
export async function migrate(
  db: DatabaseService,
  migrations: MigrationEntry[],
  options: MigrateOptions = {},
): Promise<void> {
  const targetVersion = migrations.length;
  if (targetVersion === 0) return;

  const stamp = options.userVersion;
  const table = options.table ?? '__migrations';
  const selectApplied = 'SELECT name FROM ' + table;

  const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = Number(rows[0]?.user_version ?? 0);
  if (stamp === undefined && currentVersion >= targetVersion) return;

  if (stamp !== undefined) {
    const tracking = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    if (tracking.length > 0) {
      const done = await db.select<{ name: string }>(selectApplied);
      const doneSet = new Set(done.map((r) => r.name));
      if (migrations.every((m) => doneSet.has(m.name))) {
        // Up to date. Re-stamp a DB created before the stamp existed (user_version = count).
        if (currentVersion !== stamp) await db.execute('PRAGMA user_version = ' + stamp);
        return;
      }
    }
  }

  await db.execute(
    'CREATE TABLE IF NOT EXISTS ' +
      table +
      ' (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, ' +
      'applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
  );

  const applied = await db.select<{ name: string }>(selectApplied);
  const appliedSet = new Set(applied.map((r) => r.name));

  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i]!;
    if (appliedSet.has(migration.name)) continue;

    const statements = migration.sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Record the migration and bump user_version atomically
    const safeName = migration.name.replace(/'/g, "''");
    statements.push('INSERT INTO ' + table + " (name) VALUES ('" + safeName + "')");
    statements.push('PRAGMA user_version = ' + (stamp ?? i + 1));

    await db.batch(statements);
  }
}
