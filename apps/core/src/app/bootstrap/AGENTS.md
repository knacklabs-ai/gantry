# Channel Wiring Notes

- `sendStreamingChunk` is a transport handoff for incremental provider text.
  Preserve leading, trailing, and whitespace-only chunks; channel-specific
  stream sinks own buffering and final formatting.
- If channel persistence auto-registers a direct conversation, await route
  registration and persistence, then enqueue the exact chat queue immediately.
  Do not couple first-message wakeup to old polling intervals; recovery scans are
  only for missed work, not the steady-state webhook path.
- For already-known inbound direct conversations, enqueue the exact chat queue
  immediately after `storeMessage` succeeds so normal webhook turns do not wait
  for recovery work.
- Interakt `providers.interakt.default_agent` routes are live virtual
  projections, not persisted per-customer routes. Keep projection logic in a
  reusable bootstrap helper so live inbound persistence and restart recovery use
  the same route shape; do not fall back to template cloning during recovery.
- Optional runtime-owned worker pools belong in bootstrap composition, not in
  `GroupQueue`: construct them only behind their default-off config/capability
  gates, pass them through `GroupProcessingDeps`, reap prior-process orphans
  during startup, and close idle workers during shutdown.
- Shutdown must stop conversation-work notification/reconciler claim sources
  before waiting on `GroupQueue`, release cleanly finished tracked owner leases
  after queue drain, then mark any remaining instance leases draining so another
  instance can take over if the process does not release cleanly.
- Durable provider-send failures must keep sanitized diagnostics bounded while
  preserving provider-neutral retry metadata such as `retryAfterSeconds`.
  Redact secrets first, then fit the final stored `delivery_error` string
  within the existing length cap so admin/recovery views can trust it.
