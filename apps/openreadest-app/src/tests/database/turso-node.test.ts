import { describe, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { baseTests } from './suites/base-tests';
import { migrationTests } from './suites/migration-tests';

// Integration tests using a real in-memory database via @tursodatabase/database, the
// same turso engine that powers @readest/turso-database-wasm in the browser. FTS and
// vector suites from upstream are omitted: no schema here uses them yet.
describe('NodeDatabaseService (real in-memory turso)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Base Operations', () => {
    baseTests(() => db);
  });

  describe('Migrations', () => {
    migrationTests(() => db);
  });
});
