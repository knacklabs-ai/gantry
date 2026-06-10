# Multi-Worker Job Execution

Safe multi-worker job execution: leases, fencing, durable interactions, and
cluster-wide concurrency, introduced ahead of live chat.

## Schema

All tables live in Postgres (`apps/core/src/adapters/storage/postgres/schema/worker-coordination.ts`,
migration `0075_multi_worker_execution.sql`):

- `worker_instances` — worker identity: image digest, boot nonce, version,
  capabilities, status, heartbeat/last-seen timestamps.
- `run_leases` — one row per claim attempt: run id, job id, worker instance,
  lease token, monotonic fencing version, status
  (`active|expired|released|completed|failed`), claimed/expires/heartbeat
  timestamps. Partial unique indexes enforce a single active lease per run and
  per job.
- `run_slots` — cluster-wide concurrency slots keyed by workspace/app/agent
  slot keys with expiry; replaces the process-local Map.
- `pending_interactions` — durable permission/question prompts with status,
  approver, expiry, callback route, and idempotency key.
- `runner_control_events` — append-only outbox; events are persisted before
  external exposure (`exposed_at` stamped by the control plane).
- `runner_control_nonces` — replay prevention with TTL.
- `transient_grants` — run-scoped grants bound to the active lease token;
  never durable authority.

## Worker claim protocol

1. The runtime registers a worker instance at scheduler startup
   (`apps/core/src/jobs/worker-identity.ts`) and heartbeats every 30s.
2. The scheduler creates runnable work; the worker claims execution.
   `claimDueRunStart` issues the run lease inside the same transaction that
   inserts the run and flips the job to `running`
   (`canonical-job-repository.postgres.ts`). The claim returns a lease token
   and fencing version; without a confirmed claim the worker does not execute.
3. Terminal writes are token-fenced: `settleRunLease` transitions the lease
   only when the caller's token is still the run's active lease. A stale
   worker whose run was recovered drops all terminal writes (including the
   failsafe path).

## Recovery

- Worker heartbeats lapse → `markStaleWorkersUnhealthy` flags the worker.
- Lease expiry lapse → `recoverExpiredRunLeases` expires only lapsed leases;
  live leases (including those of a previous incarnation of this process) are
  never released at startup.
- A retry claim gets a strictly higher fencing version (computed across the
  run's and job's lease history), so the old worker's token/version can never
  match again. Recovered retries notify:
  "Run recovered: previous worker lost its lease; Gantry safely retried this run."

## Permission durability

`pending_interactions` rows are created before a permission/question prompt
renders (`apps/core/src/application/interactions/pending-interaction-durability.ts`
wired into `apps/core/src/runtime/ipc-interaction-processing.ts`). Provider
callbacks resolve the
durable record. Persistent grants are committed to settings/Postgres before
the IPC response resumes the worker (pre-existing flow). Transient approvals
become `transient_grants` rows scoped to the active run lease.

## Acceptance gates

Covered by
`apps/core/test/integration/worker-coordination.postgres.integration.test.ts`:
double-claim refusal, stale-worker fencing, crash releasing only expired
leases, restart-surviving prompts, replayed-event rejection, lease-scoped
transient grants, cluster slot capacity/reclaim, and worker health sweeps.
