# Skills Registry

MyClaw keeps skills as files, but the registry is the source of truth for which
skills exist, which versions are approved, and which agents receive them.

## Storage Model

- `skill_catalog` stores skill identity, app, name, description, source, and
  status.
- `skill_versions` stores immutable version metadata, entrypoint, manifest
  JSON, aggregate content hash, approval status, creator, and created time.
- `skill_assets` stores file paths, content type, storage backend, storage
  reference, file hash, and size.
- `agent_skill_bindings` enables or disables a skill for an agent, optionally
  pinned to a specific approved version.

V1 stores skill bytes under the local MyClaw artifact root. The database stores
the `storageRef`, so a later object-store backend can use the same registry
shape without making Claude config files durable.

## Bundled Skills

Repo bundled skills under `.claude/skills` are read during storage bootstrap
only. Bootstrap copies each valid skill folder into local artifact storage,
creates an approved bundled version using a deterministic content hash, and
binds it to the default personal agent. Re-running bootstrap is idempotent:
unchanged file content produces the same version ID and asset hashes.

The repo `.claude/skills` folder is not read by runtime materialization.

## Custom Skills

Admins or agents can import a folder by sending the folder files to the control
API as a new skill version. Imported versions start as `draft`. The version
record and assets are immutable after creation; changing files creates another
version.

Approval is a registry state transition:

- `draft` can be approved or rejected.
- `approved` versions are immutable and cannot be rejected later.
- `rejected` versions are retained for auditability but are not materialized.

There is no Slack, Telegram, or automatic agent-created approval UI in V1.

## Agent Bindings

An agent receives a skill only when:

- the catalog item is `active`;
- the agent binding is `active`;
- the selected version, or latest resolved version, is `approved`.

Disabled skills, disabled bindings, draft versions, and rejected versions are
not copied into provider runtime files.

## Runtime Materialization

For each Claude run, MyClaw creates a temporary `CLAUDE_CONFIG_DIR` and writes
approved enabled skill assets into `CLAUDE_CONFIG_DIR/skills/<skill-name>/`.
That directory is generated scratch state and can be deleted after the run.
