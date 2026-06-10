# Manual Lead Extraction from the Live Transcript

Status: approved (design)
Owner: Boondi/mcp-crm
Related: [agent-declared-commands.md](../../architecture/agent-declared-commands.md),
[2026-06-09-agent-declared-commands.md](../plans/2026-06-09-agent-declared-commands.md)

## Problem

`/extract-leads-queries` runs the digest-clocked extraction cycle scoped to one
conversation. A digest only exists after a session boundary (idle ≥
`idle_end_minutes`, or `/digest-session`), so running the command mid-conversation
returns `Digests: 0` and extracts nothing. Real incident (2026-06-09): operator ran
the command at 19:50 → `Digests: 0`; the session idled at 19:56 (digest written);
the background watcher extracted at 19:58. The operator expected the command to
capture the conversation *now*.

Root insight (verified in code): the extractor never extracts *from* the digest.
Its data inputs are the **transcript** (`loadTranscript` over `messages` ⋈
`message_parts`) and the **open opportunities** (`getOpenOpportunitiesByPhone`,
which carries the matchable `bcr_` ids). The digest functions only as the
*boundary clock* for the background watcher. A human typing the command **is** a
boundary declaration, so the manual path needs no digest and no cursor.

## Decision

The manual admin endpoint extracts directly from the live transcript:
**transcript + open opportunities → LLM → upsert**. It reads no digest, reads no
cursor, writes no cursor. The background watcher keeps its digest clock and
`boondi_digest_cursor` exactly as today. All changes live in `packages/mcp-crm`
plus the agent command module's reply text; Gantry core is untouched.

`digestText` is intentionally **not** included in the manual prompt: its content
is a subset of the transcript (digests cover disjoint recent windows — they carry
no deep history), it carries no matchable ids, and any summary risks anchoring
the model away from the raw transcript. Cost/benefit is a wash; simplest wins.

## Design

### 1. `runManualConversationExtraction` (new, `packages/mcp-crm/src/watcher/index.ts`)

```ts
export interface ManualExtractionStats {
  extracted: number;
  created: number;
  updated: number;
  skipped: number;
}

export async function runManualConversationExtraction(
  deps: WatcherDeps,
  conversationId: string,
): Promise<ManualExtractionStats>
```

Steps:
1. Validate `conversationId` against `/^conversation:wa:\d+$/` (defense-in-depth;
   the HTTP layer also validates). Throw on mismatch.
2. Throw if `deps.llm` is null (defense-in-depth; the endpoint pre-checks and
   returns 503 before calling — see §4; never a silent all-zeros result).
3. `loadTranscript(pool, gantrySchema, conversationId)` — newest-window (§3),
   control-command lines stripped (existing behavior). Empty transcript →
   return all-zeros stats without an LLM call.
4. `repo.getOpenOpportunitiesByPhone(phone)` — phone via
   `phoneFromConversationId`.
5. `extractOpportunities(llm, { conversationId, phone, transcript,
   digestText: '', openOpportunities })` with the existing `onFailure` logger
   hook. Privacy rules match the current manual trigger: hashed
   `conversationRef` in logs, `rawHead` omitted.
6. Parse failure (`null` result) → `skipped: 1`, return.
7. `applyExtraction(repo, …)` → accumulate `created`/`updated`.
8. Log a `manual_extraction_completed` info line (conversationRef,
   transcriptMessages, openOpportunities, stats).

No dry-run mode: the manual path always applies. (Dry-run stays available on the
background cycle only; the plan verifies no caller relied on manual dry-run.)

### 2. Digest cycle simplification (same file)

`runDigestCycleOnce` drops the `'manual'` trigger: `DigestCycleOptions.trigger`
narrows to `'timer' | 'startup'`; `assertDigestCycleOptions` and
`MANUAL_CONVERSATION_ID_RE` are deleted (validation now lives in §1/§4). The
`conversationId`/`since` filter plumbing in `PendingDigestFilter` stays (harmless,
used by tests), but no production caller passes a manual trigger anymore.

### 3. `loadTranscript` newest-window fix (`packages/mcp-crm/src/reconciler/gantry-source.ts`)

Latent bug, affects both paths: `ORDER BY created_at ASC … LIMIT 80` returns the
**oldest** 80 messages, so conversations longer than 80 messages would be
extracted from stale history and miss the newest turns — exactly the turns that
triggered extraction. Fix: select the newest `maxMessages` (`ORDER BY created_at
DESC, ordinal DESC LIMIT n` in a subquery), then re-sort ascending for the
prompt. The control-command stripping loop is unchanged.

Capacity rationale: dropping the *oldest* overflow is safe because previously
extracted content already lives in `boondi_business_records` and re-enters every
prompt via the open-opportunities list. `maxMessages` stays 80 (parameter exists
if ever needed).

### 4. HTTP endpoint (`packages/mcp-crm/src/server.ts`)

`POST /admin/extract-leads-queries` keeps its auth (identity header), method
check, and body validation, and now:
- `llm` unavailable → `503 { error: 'extractor_disabled' }` (replaces today's
  silent all-zeros — the exact confusion that motivated this design).
- Otherwise → `runManualConversationExtraction` → `200 { ok: true, stats }`
  where `stats` is `ManualExtractionStats` (no `digests` field).
- Unexpected throw → existing `500 { error: 'internal_error' }` path.

### 5. Command module reply (`agents/boondi_support/commands/extract-leads-queries.ts`)

`parseStats` drops `digests`. Reply becomes:

```
Lead/query extraction processed. Extracted: N. Created: X. Updated: Y. Skipped: Z.
```

The leading phrase is unchanged, so the regression matcher
(`scripts/boondi-regression.mjs` `COMMAND_REPLY['/extract-leads-queries']`,
`/Lead\/query extraction processed\./i`) still matches.

## Error handling (operator-visible, nothing silent)

| Condition | Endpoint | Chat reply |
|---|---|---|
| LLM key missing | 503 `extractor_disabled` | `/extract-leads-queries failed: …` |
| LLM output unparseable | 200, `skipped: 1` | `… Skipped: 1.` (re-run is safe) |
| Empty conversation | 200, all zeros | `… Extracted: 0. Created: 0. …` |
| Non-`wa:` conversation | 400 (existing) | command run() throws → failure reply |
| CRM service down | fetch fails | failure reply (existing module behavior) |

## Idempotency & convergence

The manual path is stateless (no cursor). Re-runs and the background path
converge through the existing match mechanism: the extractor matches against the
customer's **open** opportunities (`query/qualifying/lead`; closed rows are
invisible and untouchable) and `applyExtraction` updates matched rows in place,
status never downgrading. When the session later idles, the background watcher
processes its digest, sees the already-updated rows, and updates again —
no duplicates. Known residual risk (unchanged from today): the LLM may
mis-match (`match: null` on a true match), creating a duplicate open row;
accepted for an operator tool.

## Compatibility ripples

- **Regression harness absent-checks** (`scripts/lib/crm-db.mjs`
  `waitForRecord`): for `absent` expectations it waits for
  `boondi_digest_cursor` to advance as proof extraction ran. The manual command
  no longer advances that cursor, and the background watcher ticks every 240s
  (`BOONDI_CRM_RECONCILE_INTERVAL_MS` default) — beyond the 90s poll window.
  Fix in the same change: the command's synchronous reply **is** the
  processed-signal for the manual path; the harness treats the
  `Lead/query extraction processed.` reply as proof and skips the cursor wait
  for these scenarios. (`/digest-session` remains in the scenario command order;
  it still exercises the memory path and feeds the background watcher.)
- **Watcher tests**: existing manual-trigger tests
  (`packages/mcp-crm/test/watcher.test.ts`) migrate to
  `runManualConversationExtraction` (conversation-id rejection, command-message
  stripping, log privacy); manual dry-run coverage is retired with the mode.
- **`server.test.ts`**: endpoint tests update for the new stats shape and the
  503 branch.

## Out of scope

- Background watcher semantics, `boondi_digest_cursor`, and the digest-as-clock
  design (kept; rationale in the architecture doc).
- The background path's prompt shape (it still passes the digest it already
  holds).
- Gantry core, the command registry, `settings.yaml`, memory pipeline.
- Raising `maxMessages` or making it configurable.

## Testing (TDD per task)

1. `runManualConversationExtraction`: extracts + applies with **zero digest rows
   present**; `boondi_digest_cursor` untouched after the run (assert no row /
   unchanged row); empty transcript → zeros without LLM call; invalid
   conversation id → throws; parse failure → `skipped: 1`, nothing applied;
   logs use hashed ref, no raw phone.
2. `loadTranscript`: >80-message conversation → returns the **newest** 80,
   ascending order, command lines still stripped.
3. `server`: 503 when extractor disabled; 200 + new stats shape on success.
4. Command module: reply format without `Digests:`; failure text on 503.
5. Harness: absent-scenario uses reply-as-signal (no cursor wait).
