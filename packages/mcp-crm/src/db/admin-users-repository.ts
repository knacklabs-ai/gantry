import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  type AdminRole,
  type AdminStatus,
  normalizeAdminEmail,
} from '../admin-auth.js';

interface AdminUserRow {
  id: string;
  email: string;
  password_hash?: string;
  role: AdminRole;
  status: AdminStatus;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  role: AdminRole;
  status: AdminStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserWithPassword extends AdminUser {
  passwordHash: string;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function rowToUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
    lastLoginAt: toIso(row.last_login_at),
  };
}

function rowToUserWithPassword(row: AdminUserRow): AdminUserWithPassword {
  return {
    ...rowToUser(row),
    passwordHash: row.password_hash ?? '',
  };
}

const USER_COLUMNS = `
  id, email, role, status, created_at, updated_at, last_login_at
`;

const USER_WITH_PASSWORD_COLUMNS = `
  id, email, password_hash, role, status, created_at, updated_at, last_login_at
`;

export class AdminUsersRepository {
  constructor(private readonly pool: Pool) {}

  async countUsers(): Promise<number> {
    const res = await this.pool.query(
      `SELECT count(*)::int AS count FROM boondi_admin_users`,
    );
    return Number(res.rows[0]?.count ?? 0);
  }

  async listUsers(): Promise<AdminUser[]> {
    const res = await this.pool.query(
      `SELECT ${USER_COLUMNS}
       FROM boondi_admin_users
       ORDER BY created_at DESC, email ASC`,
    );
    return res.rows.map(rowToUser);
  }

  async findByEmail(email: string): Promise<AdminUserWithPassword | null> {
    const res = await this.pool.query(
      `SELECT ${USER_WITH_PASSWORD_COLUMNS}
       FROM boondi_admin_users
       WHERE email = $1
       LIMIT 1`,
      [normalizeAdminEmail(email)],
    );
    return res.rows[0] ? rowToUserWithPassword(res.rows[0]) : null;
  }

  async findPublicByEmail(email: string): Promise<AdminUser | null> {
    const res = await this.pool.query(
      `SELECT ${USER_COLUMNS}
       FROM boondi_admin_users
       WHERE email = $1
       LIMIT 1`,
      [normalizeAdminEmail(email)],
    );
    return res.rows[0] ? rowToUser(res.rows[0]) : null;
  }

  async createUser(params: {
    email: string;
    passwordHash: string;
    role: AdminRole;
  }): Promise<AdminUser> {
    const res = await this.pool.query(
      `INSERT INTO boondi_admin_users (
         id, email, password_hash, role
       ) VALUES ($1, $2, $3, $4)
       RETURNING ${USER_COLUMNS}`,
      [randomUUID(), normalizeAdminEmail(params.email), params.passwordHash, params.role],
    );
    return rowToUser(res.rows[0]);
  }

  async updateUser(params: {
    id: string;
    role?: AdminRole;
    status?: AdminStatus;
  }): Promise<AdminUser | null> {
    const res = await this.pool.query(
      `UPDATE boondi_admin_users
       SET
         role = COALESCE($2, role),
         status = COALESCE($3, status),
         updated_at = now()
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [params.id, params.role ?? null, params.status ?? null],
    );
    return res.rows[0] ? rowToUser(res.rows[0]) : null;
  }

  async updatePassword(params: {
    id: string;
    passwordHash: string;
  }): Promise<AdminUser | null> {
    const res = await this.pool.query(
      `UPDATE boondi_admin_users
       SET password_hash = $2, updated_at = now()
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [params.id, params.passwordHash],
    );
    return res.rows[0] ? rowToUser(res.rows[0]) : null;
  }

  async markLogin(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE boondi_admin_users
       SET last_login_at = now(), updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }
}
