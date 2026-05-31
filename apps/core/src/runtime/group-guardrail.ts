import type {
  MessageSendOptions,
  NewMessage,
  ConversationRoute,
} from '../domain/types.js';
import {
  customerVisibleGuardrailResponse,
  evaluateAgentGuardrail,
} from '../application/guardrails/guardrail-service.js';
import { resolveGuardrailPolicy } from '../application/guardrails/policy-registry.js';
import type {
  GuardrailClassifier,
  GuardrailContextMessage,
} from '../application/guardrails/types.js';
import {
  encodeGroupMessageCursor,
  toGroupMessageCursor,
} from '../shared/message-cursor.js';
import { isFlowLogEnabled } from '../shared/flow-log.js';
import type { GroupProcessingDeps } from './group-processing-types.js';

export async function handlePreAgentGuardrail(input: {
  group: ConversationRoute;
  messages: readonly NewMessage[];
  latestMessage: NewMessage;
  queueJid: string;
  /**
   * Recent prior turns (oldest→newest, role-tagged) that precede `messages`, so
   * the policy can judge a follow-up in context. Optional — absent → the
   * guardrail screens this turn statelessly, as before.
   */
  recentContext?: readonly GuardrailContextMessage[];
  guardrailClassifier?: GuardrailClassifier;
  sendMessage: (text: string, options?: MessageSendOptions) => Promise<void>;
  buildMessageOptions: (threadId?: string) => MessageSendOptions | undefined;
  setCursor: GroupProcessingDeps['setCursor'];
  saveState: GroupProcessingDeps['saveState'];
  info: (metadata: Record<string, unknown>, message: string) => void;
}): Promise<boolean> {
  const guardrail = input.group.agentConfig?.plugins?.guardrail;
  if (!guardrail) return false;

  // Resolve the agent's guardrail plugin by its declared file name
  // (`plugins.guardrail.file`) from the runtime folder, or the generic
  // domain-free fallback if that file is missing/invalid. The deterministic
  // layer and classifier prompt come from the resolved policy — core holds no
  // agent content.
  const { policy, source } = await resolveGuardrailPolicy(
    input.group.folder,
    guardrail.file,
  );

  const decision = await evaluateAgentGuardrail({
    config: guardrail,
    messages: input.messages.map((message) => message.content),
    classifier: input.guardrailClassifier,
    policy,
    context: input.recentContext,
  });
  // Flow trace: include the text the guardrail judged so the decision is
  // explainable in the test harness (opt-in; off in production).
  const flowFields = isFlowLogEnabled()
    ? {
        flow: 'guardrail',
        inboundText: input.latestMessage.content,
        guardrailContextTurns: input.recentContext?.length ?? 0,
      }
    : {};
  if (decision.action === 'direct_response') {
    await input.sendMessage(
      customerVisibleGuardrailResponse(policy, decision.responseKind),
      input.buildMessageOptions(input.latestMessage.thread_id),
    );
    input.setCursor(
      input.queueJid,
      encodeGroupMessageCursor(toGroupMessageCursor(input.latestMessage)),
    );
    await input.saveState();
    input.info(
      {
        group: input.group.name,
        guardrailFile: guardrail.file,
        guardrailPolicyId: policy.id,
        guardrailSource: source,
        guardrailDecision: decision.responseKind,
        guardrailReason: decision.reason,
        ...flowFields,
      },
      'Guardrail handled message before agent spawn',
    );
    return true;
  }

  input.info(
    {
      group: input.group.name,
      guardrailFile: guardrail.file,
      guardrailPolicyId: policy.id,
      guardrailSource: source,
      guardrailReason: decision.reason,
      ...flowFields,
    },
    'Guardrail allowed message for agent processing',
  );
  return false;
}
