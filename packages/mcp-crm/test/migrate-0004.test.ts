import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(here, '../migrations/0004_admin_auth.sql');

function readSql(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('migration 0004 - admin auth users', () => {
  it('exists as the next Boondi CRM migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('creates admin users with hashed passwords and roles', () => {
    const sql = readSql();
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS boondi_admin_users/);
    expect(sql).toMatch(/email\s+text NOT NULL UNIQUE/);
    expect(sql).toMatch(/password_hash\s+text NOT NULL/);
    expect(sql).toMatch(/role\s+text NOT NULL/);
    expect(sql).toMatch(/super_admin/);
    expect(sql).toMatch(/admin/);
    expect(sql).toMatch(/viewer/);
    expect(sql).toMatch(/status\s+text NOT NULL/);
    expect(sql).toMatch(/last_login_at\s+timestamptz/);
  });

  it('does not store plaintext passwords', () => {
    const sql = readSql();
    expect(sql).not.toMatch(/\bpassword\s+text\b/i);
  });
});
