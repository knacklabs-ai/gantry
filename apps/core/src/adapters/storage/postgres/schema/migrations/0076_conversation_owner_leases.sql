CREATE TABLE IF NOT EXISTS conversation_owner_leases (
  app_id text NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  thread_id text REFERENCES conversation_threads(id) ON DELETE CASCADE,
  thread_key text NOT NULL,
  owner_instance_id text NOT NULL,
  worker_id text,
  lease_version bigint NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  state text NOT NULL,
  last_claim_reason text,
  last_error text,
  draining_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, conversation_id, thread_key)
);

CREATE INDEX IF NOT EXISTS idx_conversation_owner_leases_expires_at
  ON conversation_owner_leases (lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_conversation_owner_leases_owner_state
  ON conversation_owner_leases (owner_instance_id, state);
