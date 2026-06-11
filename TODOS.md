# TODOS

Deferred items from the Gantry deployment-modes plan
([docs/architecture/deployment-profiles.md](docs/architecture/deployment-profiles.md)).
Each item records why it is deferred and the trigger to revisit it. These are out
of scope for the current plan by explicit decision; do not implement them as part
of Phases 0–3.

| Item | Why deferred | Trigger to revisit |
|---|---|---|
| Multi-live GroupQueue cutover (Phase 4) | v1 accepts a single live-host ceiling; the singleton lease is already correct (user-accepted). See [ADR Deployment Modes](docs/decisions/2026-06-11-deployment-modes.md). | Live-turn throughput on one host saturates, **or** an availability requirement sets failover RTO below the live-turn lease TTL. |
| Fleet management UI | The desired-state control API ships first and is the UI's backend; the UI is its own plan. See [ADR Settings Authority](docs/decisions/2026-06-11-settings-authority.md). | Control-API desired-state endpoints are shipped and stable (end of Phase 3). |
| GCP / Azure Terraform module sets | AWS-first per user; module interfaces stay cloud-neutral so these are cheap to add later. See [ADR Delivery Vehicle](docs/decisions/2026-06-11-delivery-vehicle.md). | A deployment target requires GCP or Azure. |
| Helm chart / Kubernetes operator | Terraform-first per user (gate U1 pending); cloud-neutral interfaces keep K8s open. | A deployment target requires Kubernetes, or gate U1 resolves to ship Helm. |
| Support **product** layer (CRM, human handoff, retention, customer-visible audit) | This plan ships the security envelope (locked preset, isolation); the product layer is a separate plan (Codex finding). | Locked support stack is in production and a customer-facing support product is prioritized. |
| Browser profile snapshot / restore | Stable in v1 because there is exactly one live host; degrades only at multi-live. See the Browser Note in [deployment-profiles.md](docs/architecture/deployment-profiles.md). | Phase 4 multi-live cutover begins (browser-bearing turns can land on different live hosts). |
| Customer-side image-bake CI pipeline | The sandboxed bake-job toolchain artifacts cover fleet correctness without customer-side CI. See [ADR Capability Artifacts](docs/decisions/2026-06-11-capability-artifacts.md). | A customer needs to build/publish their own worker images in their own CI. |
| Support-agent rate limiting | The existing conversation sender policy covers v1. | Observed abuse exceeds what the sender policy bounds, or a per-support-agent quota is required. |
