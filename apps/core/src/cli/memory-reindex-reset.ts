import fs from 'fs';

import Database from 'better-sqlite3';

const FULL_REINDEX_MEMORY_DROP_STATEMENTS = [
  'DROP TABLE IF EXISTS memory_chunk_vector_map',
  'DROP TABLE IF EXISTS memory_item_vector_map',
  'DROP TABLE IF EXISTS memory_chunks_vec',
  'DROP TABLE IF EXISTS memory_items_vec',
  'DROP TABLE IF EXISTS memory_chunks_fts',
  'DROP TABLE IF EXISTS memory_usage_events',
  'DROP TABLE IF EXISTS memory_events',
  'DROP TABLE IF EXISTS memory_chunks',
  'DROP TABLE IF EXISTS memory_procedures',
  'DROP TABLE IF EXISTS memory_items',
  'DROP TABLE IF EXISTS embedding_cache',
];

export function resetMemoryTablesForFullReindex(sqlitePath: string): void {
  if (!fs.existsSync(sqlitePath)) return;
  const db = new Database(sqlitePath);
  try {
    for (const statement of FULL_REINDEX_MEMORY_DROP_STATEMENTS) {
      try {
        db.exec(statement);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          /no such table/i.test(message) ||
          /no such module:\s*vec0/i.test(message)
        ) {
          continue;
        }
        throw err;
      }
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
  } finally {
    db.close();
  }
}
