ALTER TABLE skill_catalog
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bundled',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS skill_versions (
  id text PRIMARY KEY,
  skill_id text NOT NULL REFERENCES skill_catalog(id) ON DELETE CASCADE,
  version text NOT NULL,
  entrypoint text NOT NULL DEFAULT 'SKILL.md',
  manifest_json text NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  approval_status text NOT NULL DEFAULT 'draft',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_versions_skill_version
  ON skill_versions(skill_id, version);

CREATE INDEX IF NOT EXISTS idx_skill_versions_approval
  ON skill_versions(skill_id, approval_status);

CREATE TABLE IF NOT EXISTS skill_assets (
  id text PRIMARY KEY,
  skill_version_id text NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  path text NOT NULL,
  content_type text NOT NULL,
  storage_type text NOT NULL,
  storage_ref text NOT NULL,
  content_hash text NOT NULL,
  size_bytes integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_assets_version_path
  ON skill_assets(skill_version_id, path);

ALTER TABLE agent_skill_bindings
  ADD COLUMN IF NOT EXISTS skill_version_id text REFERENCES skill_versions(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS idx_agent_skill_bindings_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skill_bindings_unique
  ON agent_skill_bindings(agent_id, skill_id);

CREATE TABLE IF NOT EXISTS skill_registry_events (
  id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  skill_id text REFERENCES skill_catalog(id) ON DELETE SET NULL,
  skill_version_id text REFERENCES skill_versions(id) ON DELETE SET NULL,
  agent_id text REFERENCES agents(id) ON DELETE SET NULL,
  actor_ref text,
  payload_json text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_registry_events_app_event
  ON skill_registry_events(app_id, event_type, created_at);
