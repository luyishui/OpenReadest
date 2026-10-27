import { Database, LoadOptions, QueryResult } from 'tauri-plugin-turso';
import { DatabaseService, DatabaseExecResult, DatabaseRow, DatabaseOpts } from '@/types/database';

export class NativeDatabaseService implements DatabaseService {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(path: string, opts?: DatabaseOpts): Promise<NativeDatabaseService> {
    // Translate the cross-platform DatabaseOpts (WASM bindings) to tauri-plugin-turso's
    // LoadOptions. `experimental` maps directly; `encryption` shapes differ (native
    // 'aes256cbc' + byte key vs WASM ciphers + hex key) and is not wired yet. Keep the
    // plain path-string call shape when no relevant opts are set.
    const loadArg: string | LoadOptions = opts?.experimental?.length
      ? { path, experimental: opts.experimental as string[] }
      : path;
    const db = await Database.load(loadArg);
    return new NativeDatabaseService(db);
  }

  async execute(sql: string, params: unknown[] = []): Promise<DatabaseExecResult> {
    const result: QueryResult = await this.db.execute(sql, params);
    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
    };
  }

  async select<T extends DatabaseRow = DatabaseRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return await this.db.select<T[]>(sql, params);
  }

  async batch(statements: string[]): Promise<void> {
    await this.db.batch(statements);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
