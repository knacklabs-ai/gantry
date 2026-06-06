-- boondi-crm migration 0001 — Boondi business records (queries + leads).
--
-- Owned by the boondi-crm connector, NOT by Gantry core: this migration lives
-- in packages/mcp-crm/migrations and is applied by boondi-crm's own migrate
-- script, so Gantry's core schema/migrations stay free of Boondi tables.
-- Created in the CRM's OWN schema (BOONDI_CRM_DB_SCHEMA, default boondi_crm), which
-- the connector owns end-to-end. The read-only boondi-admin dashboard SELECTs it
-- explicitly as boondi_crm.boondi_business_records.
--
-- The migrate script runs this with search_path set to BOONDI_CRM_DB_SCHEMA, so
-- table names are intentionally unqualified. Idempotent (IF NOT EXISTS). Roles +
-- grants are operator-managed (the connector's DB role is set up out of band), NOT here.

CREATE TABLE IF NOT EXISTS boondi_business_records (
  id                   text PRIMARY KEY,
  phone                text NOT NULL,
  customer_name        text,
  conversation_id      text,
  status               text NOT NULL DEFAULT 'query'
                         CHECK (status IN ('query','qualifying','lead','handed_off','won','lost')),
  intent_category      text NOT NULL DEFAULT 'other'
                         CHECK (intent_category IN ('shopping','gifting_personal','gifting_b2b','corporate','reorder','other')),
  -- The five qualification fields (raw text for the human + structured for scoring).
  occasion             text,
  quantity             integer,
  quantity_raw         text,
  budget_per_gift_inr  integer,
  budget_total_inr     integer,
  budget_raw           text,
  locations            text,
  location_scope       text CHECK (location_scope IS NULL OR location_scope IN ('single','multi_drop_city','multi_city','pan_india')),
  timeline             text,
  timeline_days        integer,
  -- Scoring dimensions C/D/G.
  buyer_type           text CHECK (buyer_type IS NULL OR buyer_type IN ('personal','wedding_event','small_business','employee_gifting','client_vip_procurement')),
  customisation        text CHECK (customisation IS NULL OR customisation IN ('none','note_card','logo','custom_packaging','bespoke')),
  contact_quality      text CHECK (contact_quality IS NULL OR contact_quality IN ('name_only','phone','email_phone','corporate_email')),
  -- Computed (only for leads).
  score                integer CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  band                 text CHECK (band IS NULL OR band IN ('P1','P2','P3','P4','P5')),
  -- Human-facing context.
  summary_brief        text,
  trigger_excerpt      text,
  source               text NOT NULL DEFAULT 'agent'
                         CHECK (source IN ('agent','reconciler')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcr_phone ON boondi_business_records (phone);
CREATE INDEX IF NOT EXISTS idx_bcr_status_updated ON boondi_business_records (status, updated_at DESC);

-- NOTE: the original single-open-record-per-phone unique index
-- (uniq_bcr_open_per_phone) was REMOVED in the per-opportunity redesign — a phone
-- may now own MANY open opportunities. It is intentionally not (re)created here:
-- the runner re-applies every migration on each boot, and CREATE UNIQUE INDEX
-- would fail the moment a phone has >1 open opportunity. Migration 0002 also DROPs
-- it for databases that applied 0001 before the redesign.

-- Idempotency cursor for the durable reconciler (Phase 4): records how far the
-- backstop has classified each conversation so it never re-does work.
CREATE TABLE IF NOT EXISTS boondi_reconcile_cursor (
  conversation_id   text PRIMARY KEY,
  last_message_id   text,
  last_activity_at  timestamptz,
  checked_at        timestamptz NOT NULL DEFAULT now()
);

-- Grants are operator-managed (the CRM role owns this schema; the dashboard role
-- gets SELECT) and set up out of band. Intentionally none here, so the migration
-- never assumes a specific role name exists.
