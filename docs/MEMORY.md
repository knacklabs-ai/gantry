# Memory System

MyClaw memory stores durable facts, decisions, preferences, corrections, constraints, and reusable procedures.

Continuity uses remembered context to help the next run continue work without replaying full chat history.

## Runtime Truth

- Host runtime only.
- `settings.yaml` is the canonical runtime behavior config.
- `.env` is for secrets and channel credentials.

## Canonical Settings

Memory behavior is configured only in `~/myclaw/settings.yaml`:

```yaml
memory:
  enabled: true
  root: memory
  embeddings:
    enabled: false
    provider: disabled
    model: text-embedding-3-large
  dreaming:
    enabled: false
```

## Storage

- SQLite is the only supported memory store.
- `memory.root` resolves under the runtime home unless it is absolute.
- The default database path is `~/myclaw/memory/.cache/memory.db`.
- The journal path is `~/myclaw/memory/.journal`.

## Embeddings

- Optional.
- Disabled by default.
- Memory save/search/injection works when embeddings are disabled.
- `openai` requires `OPENAI_API_KEY` in `.env`.

## Dreaming

- Optional background memory refinement.
- Disabled by default.
- Should be used only with persistent memory enabled.

## User Controls

- `myclaw status`
- `myclaw doctor`
- `myclaw memory status`
- `myclaw memory embeddings <off|openai>`
- `myclaw memory dreaming <on|off>`

## Direct Editing Flow

1. Edit `~/myclaw/settings.yaml`.
2. Run `myclaw doctor`.
3. Restart (`myclaw restart` or `myclaw service restart`).
4. Confirm with `myclaw status`.
