-- =============================================================================
-- boondi-crm scoped least-privilege roles  (operator-applied, run as DB owner)
-- =============================================================================
-- The boondi-crm connector is a separate identity end-to-end. It OWNS the
-- `boondi_crm` schema and only READS three of Gantry's transcript tables. This
-- script gives it (and the read-only dashboard) exactly those privileges and
-- nothing else — so a CRM compromise can't touch Gantry's memory, sessions, or
-- the rest of its data.
--
-- ORDER MATTERS: apply this and point BOONDI_CRM_DATABASE_URL at boondi_crm_app
-- BEFORE the connector's first boot, so its migrate creates + OWNS boondi_crm.*
-- as this role. Replace CHANGE_ME and the dashboard role name to match your setup.

-- 1) The connector's own login role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boondi_crm_app') THEN
    CREATE ROLE boondi_crm_app LOGIN PASSWORD 'CHANGE_ME';
  END IF;
END $$;

-- 2) Its own schema — full control. (The connector's migrate also runs
--    CREATE SCHEMA IF NOT EXISTS on first boot; doing it here pins ownership.)
CREATE SCHEMA IF NOT EXISTS boondi_crm AUTHORIZATION boondi_crm_app;
GRANT ALL ON SCHEMA boondi_crm TO boondi_crm_app;
GRANT ALL ON ALL TABLES IN SCHEMA boondi_crm TO boondi_crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE boondi_crm_app IN SCHEMA boondi_crm
  GRANT ALL ON TABLES TO boondi_crm_app;

-- 3) Read-only on Gantry's transcript — and ONLY that — for the reconciler.
GRANT USAGE ON SCHEMA gantry TO boondi_crm_app;
GRANT SELECT ON gantry.messages, gantry.conversations, gantry.message_parts
  TO boondi_crm_app;

-- 4) The read-only boondi-admin dashboard. It needs to SELECT the CRM's leads
--    table. Reuse its existing role (gantry_app shown) or a dedicated read role.
GRANT USAGE ON SCHEMA boondi_crm TO gantry_app;
GRANT SELECT ON boondi_crm.boondi_business_records TO gantry_app;
ALTER DEFAULT PRIVILEGES FOR ROLE boondi_crm_app IN SCHEMA boondi_crm
  GRANT SELECT ON TABLES TO gantry_app;
