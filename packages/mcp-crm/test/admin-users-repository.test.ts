import { describe, expect, it } from 'vitest';

import { AdminUsersRepository } from '../src/db/admin-users-repository.js';
import { makeFakePool } from './helpers/fakes.js';

describe('AdminUsersRepository', () => {
  it('creates users with lower-cased email and password hash', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const { pool } = makeFakePool((sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('RETURNING')) {
        return {
          rows: [
            {
              id: 'admin_user_1',
              email: params?.[1],
              role: params?.[3],
              status: 'active',
              created_at: '2026-06-23T00:00:00.000Z',
              updated_at: '2026-06-23T00:00:00.000Z',
              last_login_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repo = new AdminUsersRepository(pool);

    const user = await repo.createUser({
      email: 'Admin@Boondi.Local',
      passwordHash: 'scrypt$hash',
      role: 'admin',
    });

    expect(user).toMatchObject({
      id: 'admin_user_1',
      email: 'admin@boondi.local',
      role: 'admin',
      status: 'active',
    });
    expect(calls[0]?.sql).toContain('INSERT INTO boondi_admin_users');
    expect(calls[0]?.params).toEqual([
      expect.any(String),
      'admin@boondi.local',
      'scrypt$hash',
      'admin',
    ]);
  });

  it('lists users without returning password hashes', async () => {
    const { pool } = makeFakePool(() => ({
      rows: [
        {
          id: 'admin_user_1',
          email: 'owner@boondi.local',
          role: 'super_admin',
          status: 'active',
          created_at: '2026-06-23T00:00:00.000Z',
          updated_at: '2026-06-23T00:00:00.000Z',
          last_login_at: '2026-06-23T01:00:00.000Z',
        },
      ],
    }));
    const repo = new AdminUsersRepository(pool);

    const users = await repo.listUsers();

    expect(users).toEqual([
      {
        id: 'admin_user_1',
        email: 'owner@boondi.local',
        role: 'super_admin',
        status: 'active',
        createdAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:00:00.000Z',
        lastLoginAt: '2026-06-23T01:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(users)).not.toContain('password_hash');
  });
});
