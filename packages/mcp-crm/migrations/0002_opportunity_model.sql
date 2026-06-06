-- packages/mcp-crm/migrations/0002_opportunity_model.sql
-- Per-opportunity model. A phone may own MANY open opportunities; the single
-- open-record-per-phone invariant is removed. Existing rows are test data and
-- are wiped (clean rebuild, no data migration -- see design spec).
-- Idempotent; runs with search_path set to the CRM schema.

-- 1. One-time wipe of legacy rows (old test data + the caller-identity phantom)
--    during the schema flip. GUARDED so it runs ONLY on the FIRST application of
--    this migration, detected by the absence of the per-opportunity `confidence`
--    column (added in step 3 below). The runner re-applies every file on each
--    boot, so an UNCONDITIONAL truncate here wipes real opportunity data on every
--    restart — exactly the bug this guard prevents.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'boondi_business_records'
      AND column_name = 'confidence'
  ) THEN
    TRUNCATE TABLE boondi_business_records;
    TRUNCATE TABLE boondi_reconcile_cursor;
  END IF;
END $$;

-- 2. Remove the single-open-record-per-phone invariant.
DROP INDEX IF EXISTS uniq_bcr_open_per_phone;

-- 3. New per-opportunity columns.
ALTER TABLE boondi_business_records
  ADD COLUMN IF NOT EXISTS confidence  double precision
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

-- 3b. Allow the background extractor as a record source (0001 only permitted
--     'agent' and 'reconciler'). Postgres can't alter a CHECK in place, so drop
--     + re-add. The name is the Postgres default for the 0001 inline constraint;
--     IF EXISTS keeps it safe if a deployment named it differently.
ALTER TABLE boondi_business_records
  DROP CONSTRAINT IF EXISTS boondi_business_records_source_check,
  ADD CONSTRAINT boondi_business_records_source_check
    CHECK (source IN ('agent','reconciler','extractor'));

-- 4. Digest-watcher idempotency cursor (replaces the reconcile cursor's role).
--    Tracks the last session-end digest processed per conversation.
CREATE TABLE IF NOT EXISTS boondi_digest_cursor (
  conversation_id   text PRIMARY KEY,
  last_digest_id    text NOT NULL,
  last_digest_at    timestamptz NOT NULL,
  checked_at        timestamptz NOT NULL DEFAULT now()
);
