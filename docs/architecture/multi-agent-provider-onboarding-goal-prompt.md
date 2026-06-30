# /goal Prompt: Multi-Agent Provider Conversation Onboarding

## Goal

Implement provider-neutral onboarding and live routing so Gantry can create and
bind multiple agents to the same provider conversation, while preserving
per-agent permissions, sessions, cursors, approvals, and tool capability
boundaries.

Use `ponytail` full mode throughout: smallest correct change, no speculative
framework, no compatibility shim for pre-release state, and no commentary except
the final closeout.

## Execution Discipline

- Strict subagent-only implementation is mandatory.
- Parent agent may coordinate, inspect, run verification, and review, but must
  not edit files directly.
- All implementation and file edits must be delegated to subagents with
  disjoint write scopes.
- Subagents must use `ponytail` and avoid progress commentary.
- Verify provider-specific behavior against official provider documentation
  before changing adapters.
- Run focused checks first, then build, launchd restart/status, the KnackLabs
  lead generator smoke, autoreview, and PR publication.

## Product Contract

- Owners can create multiple agents with different selected capabilities,
  model/persona defaults, and permission policies.
- Owners can bind any agent to any installed provider conversation: Slack,
  Teams, Telegram, Discord, or App/Web.
- Owners can bind multiple agents to one conversation. Each agent is admitted
  independently when its sender policy and trigger policy match.
- One provider message stored once may create multiple agent-specific live
  admission work items.
- Live runtime keys are agent-qualified so cursors, live turn ownership,
  provider SDK sessions, stop/continue actions, memory scope, approvals, and
  tool grants do not collide between agents in the same conversation.
- Provider delivery remains conversation/thread based. The agent-qualified key
  is internal runtime identity, not a provider address.

## Repo Truth To Preserve

- `settings_revisions` plus application services are desired-state authority;
  `settings.yaml` is the readable sync copy.
- Agents own identity, model/persona defaults, sources, and selected
  capabilities.
- Conversations own sender policy, trigger policy, control approvers, and agent
  bindings.
- Conversation approvers govern both direct/private and group/channel
  approvals.
- Public admin API, local CLI, and Gantry MCP tools are adapters over the same
  services.
- Provider or channel flags are metadata, not authorization.

## Verified Provider Facts

- Slack conversation discovery uses `conversations.list` /
  `users.conversations` with pagination, `types`, and `exclude_archived`;
  text search is local after fetch.
- Teams live channel/chat messaging is a bot transport concern; Microsoft Graph
  can help install/discover, but a Teams bot still owns runtime messages.
- Telegram membership checks use Bot API primitives such as `getChatMember` and
  must respect bot-admin limits.
- Discord channel messages and thread channels are conversation-like provider
  surfaces; archived threads can affect send behavior.

## Implementation Tasks

1. Add an agent-qualified queue identity.
   - Keep provider `chatJid` and `threadId` parseable.
   - Include a selected `agentId` / folder in internal queue identity.
   - Preserve old queue parsing for scheduler and existing non-agent keys.

2. Admit one provider message to all matching bound agents.
   - Store the canonical message once.
   - Enqueue separate live admission work items per selected agent.
   - Include agent id in live admission idempotency and queue identity.

3. Resolve route state by conversation and agent.
   - Stop treating `conversationRoutes[chatJid]` as the only routing authority
     for live admission.
   - Runtime must be able to find all active bindings for a conversation and a
     specific selected binding for an agent-qualified queue.
   - Do not add provider-specific branching to core runtime.

4. Fix CLI and API onboarding semantics.
   - `gantry agent add` must not reject a conversation solely because another
     agent is already bound there.
   - CLI writes desired state through the existing settings sync path.
   - API binding enable/update/disable remains the same public surface but must
     project and remove only the selected agent binding.

5. Keep sessions and recovery agent-scoped.
   - `getAgentTurnContext` must use the selected agent when one is provided.
   - Recovery, live turn scope, stop aliases, continuation, and cursor state
     must remain agent-qualified.

6. Add focused tests.
   - Queue key parse/build round trip with agent and thread.
   - Settings accepts two agents bound to the same conversation.
   - Live admission enqueues separate work items for two agents on one
     conversation message.
   - Processing an agent-qualified queue selects that agent's route.

## Surface Impact Matrix

| Surface | Classification | Reason |
| --- | --- | --- |
| Runtime behavior | Changed | Multiple selected agents may run from one provider message. |
| `settings.yaml` | Changed | Multiple bindings to one conversation are valid desired state. |
| Postgres/runtime projection | Changed | Live admission queue identity and binding projection become agent-scoped. |
| Control API | Changed | Existing binding endpoints must project selected binding only. |
| SDK/contracts | Unchanged by design | Provider SDK calls still receive provider conversation/thread ids. |
| CLI | Changed | Agent add/onboarding can bind additional agents to existing conversations. |
| Gantry MCP/admin tools | Deferred | Keep existing admin tool surface unless tests expose a broken binding path. |
| Channel/provider adapters | Read-only/observable | Provider docs constrain behavior; core fanout stays provider-neutral. |
| Docs/prompts | Changed | This goal prompt documents the contract. |
| Audit/events | Read-only/observable | Existing live admission/run events should show agent-qualified identity. |
| Tests/verification | Changed | Add focused unit/integration coverage plus build and runtime smoke. |

## Closeout Requirements

- Focused tests for changed runtime/settings behavior pass.
- `npm run build` passes.
- launchd `com.gantry` is restarted from this checkout and status is checked.
- KnackLabs lead generation job smoke is run and evidence is captured.
- Autoreview runs after implementation, accepted findings are fixed, and the
  loop is repeated until no accepted actionable findings remain.
- A PR is created with verification evidence.
