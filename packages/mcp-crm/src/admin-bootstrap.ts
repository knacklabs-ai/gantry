import type { Pool } from 'pg';
import type { BoondiCrmEnv } from './env.js';
import type { Logger } from './logger.js';
import { hashAdminPassword } from './admin-auth.js';
import { AdminUsersRepository } from './db/admin-users-repository.js';

export async function bootstrapFirstAdminUser(input: {
  env: BoondiCrmEnv;
  pool: Pool;
  logger: Logger;
}): Promise<void> {
  const email = input.env.adminBootstrapEmail;
  const password = input.env.adminBootstrapPassword;
  if (!email && !password) return;
  if (!email || !password) {
    throw new Error(
      'Both BOONDI_ADMIN_BOOTSTRAP_EMAIL and BOONDI_ADMIN_BOOTSTRAP_PASSWORD are required when bootstrapping admin auth.',
    );
  }

  const repo = new AdminUsersRepository(input.pool);
  if ((await repo.countUsers()) > 0) return;

  await repo.createUser({
    email,
    passwordHash: await hashAdminPassword(password),
    role: 'super_admin',
  });
  input.logger.info(
    { email },
    'boondi_crm_first_admin_user_bootstrapped',
  );
}
