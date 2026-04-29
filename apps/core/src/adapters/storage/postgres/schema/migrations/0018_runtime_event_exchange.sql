DROP TABLE IF EXISTS runtime_events CASCADE;

CREATE TABLE runtime_events (
  event_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_id text NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  agent_id text REFERENCES agents(id) ON DELETE SET NULL,
  session_id text REFERENCES agent_sessions(id) ON DELETE SET NULL,
  run_id text REFERENCES agent_runs(id) ON DELETE SET NULL,
  job_id text,
  trigger_id text,
  conversation_id text REFERENCES channel_conversations(id) ON DELETE SET NULL,
  thread_id text REFERENCES conversation_threads(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor text NOT NULL,
  correlation_id text,
  response_mode text,
  webhook_id text,
  payload_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_runtime_events_app_cursor
  ON runtime_events(app_id, event_id);

CREATE INDEX idx_runtime_events_session_cursor
  ON runtime_events(session_id, event_id);

CREATE INDEX idx_runtime_events_run_cursor
  ON runtime_events(run_id, event_id);

CREATE INDEX idx_runtime_events_job_cursor
  ON runtime_events(job_id, event_id);

CREATE INDEX idx_runtime_events_trigger_cursor
  ON runtime_events(trigger_id, event_id);

CREATE INDEX idx_runtime_events_conversation_thread_cursor
  ON runtime_events(conversation_id, thread_id, event_id);

CREATE INDEX idx_runtime_events_type_cursor
  ON runtime_events(event_type, event_id);

CREATE INDEX idx_runtime_events_webhook_projection
  ON runtime_events(webhook_id, response_mode, event_id);

INSERT INTO apps (id, slug, name, status, created_at, updated_at)
VALUES ('default', 'default', 'Default Runtime App', 'active', now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO runtime_events (
  event_id,
  app_id,
  session_id,
  job_id,
  run_id,
  trigger_id,
  event_type,
  actor,
  correlation_id,
  payload_json,
  created_at
)
OVERRIDING SYSTEM VALUE
SELECT
  event.event_id,
  COALESCE(session.app_id, webhook_app.app_id, 'default') AS app_id,
  event.session_id,
  event.job_id,
  event.run_id,
  event.trigger_id,
  event.event_type,
  event.actor,
  event.correlation_id,
  event.payload,
  event.created_at
FROM control_http_events event
LEFT JOIN control_http_sessions session
  ON session.session_id = event.session_id
LEFT JOIN (
  SELECT DISTINCT ON (delivery.event_id)
    delivery.event_id,
    webhook.app_id
  FROM control_http_webhook_deliveries delivery
  INNER JOIN control_http_webhooks webhook
    ON webhook.webhook_id = delivery.webhook_id
  ORDER BY delivery.event_id, delivery.created_at
) webhook_app
  ON webhook_app.event_id = event.event_id;

SELECT setval(
  pg_get_serial_sequence('runtime_events', 'event_id'),
  GREATEST(COALESCE((SELECT MAX(event_id) FROM runtime_events), 0) + 1, 1),
  false
);

INSERT INTO runtime_events (
  app_id,
  agent_id,
  session_id,
  run_id,
  job_id,
  conversation_id,
  thread_id,
  event_type,
  actor,
  payload_json,
  created_at
)
SELECT
  event.app_id,
  run.agent_id,
  run.session_id,
  event.run_id,
  run.job_id,
  run.conversation_id,
  run.thread_id,
  event.type,
  'runtime',
  event.payload_json,
  event.created_at
FROM agent_run_events event
LEFT JOIN agent_runs run
  ON run.id = event.run_id;

ALTER TABLE control_http_webhook_deliveries
  DROP CONSTRAINT IF EXISTS control_http_webhook_deliveries_event_id_fkey;

ALTER TABLE control_http_webhook_deliveries
  ADD CONSTRAINT control_http_webhook_deliveries_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES runtime_events(event_id) ON DELETE CASCADE;

DROP TABLE IF EXISTS agent_run_events;
DROP TABLE IF EXISTS control_http_events;
