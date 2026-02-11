import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { ensureSchema } from './schema.js';

export const DEFAULT_DB_PATH = join(homedir(), '.context-diag', 'index.db');

/**
 * Open (or create) the SQLite database.
 * Pass `:memory:` for in-memory testing.
 */
export function openDatabase(dbPath: string = DEFAULT_DB_PATH): { db: Database; close: () => void } {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  ensureSchema(db);

  return {
    db,
    close: () => db.close(),
  };
}
