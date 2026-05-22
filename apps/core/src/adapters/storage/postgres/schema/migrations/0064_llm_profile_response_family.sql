-- Irreversible clean cut: llm_profiles now stores canonical response family.
-- Route/provider distinctions are adapter metadata and are intentionally not
-- recoverable from this column after the cutover.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'llm_profiles'
      AND column_name = 'provider'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'llm_profiles'
      AND column_name = 'response_family'
  ) THEN
    ALTER TABLE llm_profiles
      RENAME COLUMN provider TO response_family;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'llm_profiles'
      AND column_name = 'response_family'
  ) THEN
    ALTER TABLE llm_profiles
      ADD COLUMN response_family text NOT NULL DEFAULT 'anthropic';
  END IF;
END $$;

ALTER TABLE llm_profiles
  ALTER COLUMN response_family SET DEFAULT 'anthropic';

UPDATE llm_profiles
SET response_family = CASE
  WHEN response_family = 'openai' THEN 'openai'
  ELSE 'anthropic'
END
WHERE response_family IS DISTINCT FROM 'anthropic'
  AND response_family IS DISTINCT FROM 'openai';

UPDATE llm_profiles
SET model_alias = 'opus'
WHERE model_alias IN ('default', 'runtime-default')
   OR trim(model_alias) = '';

ALTER TABLE llm_profiles
  DROP CONSTRAINT IF EXISTS llm_profiles_response_family_valid;

ALTER TABLE llm_profiles
  ADD CONSTRAINT llm_profiles_response_family_valid
  CHECK (response_family IN ('anthropic', 'openai')) NOT VALID;
