-- boondi-crm migration 0004 - Boondi Admin authentication users.
--
-- Owned by Boondi CRM, not Gantry core. Boondi Admin may display and manage
-- these users through signed CRM admin endpoints, but must not write this table
-- directly.

CREATE TABLE IF NOT EXISTS boondi_admin_users (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL
                  CHECK (role IN ('super_admin','admin','viewer')),
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bau_role_status
  ON boondi_admin_users (role, status);
