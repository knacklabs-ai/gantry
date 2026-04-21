import fs from 'fs';

import Database from 'better-sqlite3';

import {
  ensureRuntimeSettings,
  resolveRuntimeStorageSqlitePath,
} from './runtime-settings.js';

interface SqliteGroupInspection {
  count: number;
  error?: string;
  unavailable?: boolean;
}

interface SqliteFolderInspection {
  folders: string[];
  error?: string;
  unavailable?: boolean;
}

function resolveDoctorSqliteStorage(runtimeHome: string): {
  dbPath?: string;
  unavailable?: boolean;
  error?: string;
} {
  try {
    const settings = ensureRuntimeSettings(runtimeHome);
    const dbPath = resolveRuntimeStorageSqlitePath(runtimeHome, settings);
    return { dbPath };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function inspectProviderGroupCount(
  runtimeHome: string,
  jidPrefix: string,
): SqliteGroupInspection {
  const sqliteStorage = resolveDoctorSqliteStorage(runtimeHome);
  if (sqliteStorage.unavailable) {
    return { count: 0, unavailable: true };
  }
  if (sqliteStorage.error) {
    return { count: 0, error: sqliteStorage.error };
  }
  const dbPath = sqliteStorage.dbPath;
  if (!dbPath) {
    return { count: 0, error: 'storage sqlite path is unavailable' };
  }
  if (!fs.existsSync(dbPath)) {
    return { count: 0 };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(
        `SELECT COUNT(*) as count FROM registered_groups WHERE jid LIKE ?`,
      )
      .get(`${jidPrefix}%`) as { count: number };
    return { count: row.count };
  } catch (err) {
    return {
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors and preserve primary failure.
    }
  }
}

export function inspectTelegramGroupCount(
  runtimeHome: string,
): SqliteGroupInspection {
  return inspectProviderGroupCount(runtimeHome, 'tg:');
}

export function inspectSlackGroupCount(
  runtimeHome: string,
): SqliteGroupInspection {
  return inspectProviderGroupCount(runtimeHome, 'sl:');
}

export function inspectRegisteredGroupCount(
  runtimeHome: string,
): SqliteGroupInspection {
  const sqliteStorage = resolveDoctorSqliteStorage(runtimeHome);
  if (sqliteStorage.unavailable) {
    return { count: 0, unavailable: true };
  }
  if (sqliteStorage.error) {
    return { count: 0, error: sqliteStorage.error };
  }
  const dbPath = sqliteStorage.dbPath;
  if (!dbPath) {
    return { count: 0, error: 'storage sqlite path is unavailable' };
  }
  if (!fs.existsSync(dbPath)) {
    return { count: 0 };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM registered_groups`)
      .get() as { count: number };
    return { count: row.count };
  } catch (err) {
    return {
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors and preserve primary failure.
    }
  }
}

export function inspectRegisteredGroupFolders(
  runtimeHome: string,
): SqliteFolderInspection {
  const sqliteStorage = resolveDoctorSqliteStorage(runtimeHome);
  if (sqliteStorage.unavailable) {
    return { folders: [], unavailable: true };
  }
  if (sqliteStorage.error) {
    return { folders: [], error: sqliteStorage.error };
  }
  const dbPath = sqliteStorage.dbPath;
  if (!dbPath) {
    return { folders: [], error: 'storage sqlite path is unavailable' };
  }
  if (!fs.existsSync(dbPath)) {
    return { folders: [] };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT folder FROM registered_groups WHERE folder IS NOT NULL AND TRIM(folder) != ''`,
      )
      .all() as Array<{ folder: string }>;
    const folders = rows
      .map((row) => String(row.folder || '').trim())
      .filter((value) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value));
    return { folders: [...new Set(folders)] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no such column:\\s*folder/i.test(message)) {
      return { folders: [] };
    }
    return { folders: [], error: message };
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors and preserve primary failure.
    }
  }
}
