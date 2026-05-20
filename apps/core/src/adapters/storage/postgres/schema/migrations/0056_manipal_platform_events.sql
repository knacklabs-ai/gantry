CREATE TABLE IF NOT EXISTS "manipal_platform_events" (
  "event_id" text PRIMARY KEY,
  "event_type" text NOT NULL,
  "target_jid" text,
  "status" text NOT NULL,
  "payload_json" text NOT NULL,
  "response_json" text,
  "error" text,
  "received_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_manipal_platform_events_status"
  ON "manipal_platform_events" ("status", "updated_at");

CREATE INDEX IF NOT EXISTS "idx_manipal_platform_events_target"
  ON "manipal_platform_events" ("target_jid", "updated_at");
