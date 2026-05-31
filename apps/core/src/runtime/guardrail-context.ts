import type { RuntimeMessageRepository } from '../domain/repositories/ops-repo.js';
import type { GuardrailContextMessage } from '../application/guardrails/types.js';
import { logger } from '../infrastructure/logging/logger.js';

// How many prior turns of context to hand the guardrail, and the per-message
// character cap. Small on purpose: the guardrail only needs enough recent
// conversation to tell an in-scope follow-up from a topic change, not the whole
// transcript. Capping keeps the (cheap) classifier prompt small.
const MAX_CONTEXT_TURNS = 10;
const MAX_CONTEXT_TEXT = 600;

/**
 * Build role-tagged recent conversation context for the pre-agent guardrail.
 *
 * Reads the last few messages in BOTH directions (customer + assistant) and
 * returns them oldest→newest, excluding the turn(s) currently being judged
 * (`excludeMessageIds`) so context never duplicates `messages`. Degrades to an
 * empty array when the repository cannot read outbound history or the read
 * fails — the guardrail then screens statelessly, exactly as before.
 */
export async function loadGuardrailContext(input: {
  repository: RuntimeMessageRepository;
  chatJid: string;
  threadId?: string | null;
  excludeMessageIds: ReadonlySet<string>;
}): Promise<GuardrailContextMessage[]> {
  const repo = input.repository;
  if (typeof repo.getRecentMessages !== 'function') return [];

  let recent: Awaited<ReturnType<NonNullable<typeof repo.getRecentMessages>>>;
  try {
    // Only constrain by thread when the turn is actually in a thread; for a DM
    // (no thread) pass no filter, mirroring getMessagesSince's DM behavior, so a
    // null-thread mismatch can't silently drop all context.
    recent = await repo.getRecentMessages(
      input.chatJid,
      MAX_CONTEXT_TURNS + 8,
      input.threadId ? { threadId: input.threadId } : {},
    );
    // eslint-disable-next-line no-catch-all/no-catch-all -- Context is best-effort; a read failure must not block the guardrail.
  } catch (err) {
    logger.warn(
      {
        chatJid: input.chatJid,
        err: err instanceof Error ? err.message : String(err),
      },
      'Failed to load guardrail conversation context; screening without it',
    );
    return [];
  }

  const context: GuardrailContextMessage[] = [];
  for (const msg of recent) {
    if (input.excludeMessageIds.has(msg.id)) continue;
    const text = (msg.content ?? '').trim();
    if (!text) continue;
    context.push({
      role: msg.is_from_me || msg.is_bot_message ? 'assistant' : 'customer',
      text:
        text.length > MAX_CONTEXT_TEXT
          ? `${text.slice(0, MAX_CONTEXT_TEXT)}…`
          : text,
    });
  }
  // recent is oldest→newest; keep only the most recent window.
  return context.slice(-MAX_CONTEXT_TURNS);
}
