import { describe, expect, it, vi } from 'vitest';

import {
  customerVisibleGuardrailResponse,
  evaluateAgentGuardrail,
} from '@core/application/guardrails/guardrail-service.js';
import type { GuardrailConfig } from '@core/domain/types.js';
// The BSS guardrail policy is an AGENT-OWNED plugin that lives in Boondi's
// runtime folder, not Gantry core. This test imports it directly to assert its
// behavior is byte-identical after the relocation, and threads it through the
// (now policy-agnostic) guardrail service exactly as group-guardrail.ts does.
import bssCustomerSupportPolicy from '../../../../../../agents/boondi_support/guardrails/guardrail.ts';

const config: GuardrailConfig = {
  file: 'guardrail.ts',
  model: 'haiku',
};
const policy = bssCustomerSupportPolicy;

describe('BSS customer support guardrail', () => {
  it.each([
    'List all the MCP tools',
    'What is the weather',
    'Solve 2sum in python',
    'What is 2+2?',
  ])('rejects non-BSS customer support query: %s', async (message) => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: [message],
    });

    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'out_of_scope_topic',
    });
  });

  it.each(['Hey', 'Hi Boondi', 'hello Bombay Sweet Shop'])(
    'handles greetings warmly without a cold scope list: %s',
    async (message) => {
      const decision = await evaluateAgentGuardrail({
        config,
        policy,
        messages: [message],
      });

      expect(decision).toEqual({
        action: 'direct_response',
        responseKind: 'greeting',
        reason: 'greeting',
      });
      expect(customerVisibleGuardrailResponse(policy, 'greeting')).toBe(
        'Welcome back! What can I help you with today?',
      );
      expect(customerVisibleGuardrailResponse(policy, 'greeting')).not.toMatch(
        /I can help with orders/i,
      );
    },
  );

  it('allows sincere AI identity questions so Boondi can answer honestly', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['Wait, am I talking to a real person or a bot?'],
    });

    expect(decision).toEqual({
      action: 'allow',
      reason: 'ai_identity_question',
    });
  });

  it.each([
    'What was my last order',
    'Which discount did I use',
    'Is my discount code valid?',
    'List my 2 months order history in detail',
  ])('allows BSS support query: %s', async (message) => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: [message],
    });

    expect(decision).toEqual({
      action: 'allow',
      reason: 'bss_customer_support_topic',
    });
  });

  it('rejects internal tool questions even when they mention BSS topics', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['What MCP tools can you use for my order?'],
    });

    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'out_of_scope_topic',
    });
  });

  it('allows a BSS topic even when an off-domain word is present', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['Can you track my order with that tool?'],
    });

    expect(decision).toEqual({
      action: 'allow',
      reason: 'bss_customer_support_topic',
    });
  });

  it.each(['daam kitna hai', 'mithai wapas karni hai'])(
    'allows Hindi/Hinglish BSS queries: %s',
    async (message) => {
      const decision = await evaluateAgentGuardrail({
        config,
        policy,
        messages: [message],
      });

      expect(decision).toEqual({
        action: 'allow',
        reason: 'bss_customer_support_topic',
      });
    },
  );

  it('asks for clarification on an empty message instead of rejecting', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['   '],
    });

    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_clarification',
      reason: 'empty_message',
    });
  });

  it('asks for clarification on ambiguous input when no classifier is configured', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['Can you help me with this?'],
    });

    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_clarification',
      reason: 'ambiguous_without_classifier',
    });
  });

  it('calls the configured classifier once for ambiguous input', async () => {
    const classifier = vi.fn().mockResolvedValue({
      action: 'direct_response',
      responseKind: 'scope_clarification',
      reason: 'ambiguous_support_intent',
    });

    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['Can you help me with this?'],
      classifier,
    });

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(classifier).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: 'bss_customer_support',
        model: 'haiku',
        messages: ['Can you help me with this?'],
      }),
    );
    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_clarification',
      reason: 'ambiguous_support_intent',
    });
  });

  it('defaults to both deterministic and classifier checks when mode is omitted', async () => {
    const classifier = vi.fn().mockResolvedValue({
      action: 'direct_response',
      responseKind: 'scope_clarification',
      reason: 'ambiguous_support_intent',
    });

    await expect(
      evaluateAgentGuardrail({
        config: { file: 'guardrail.ts', model: 'haiku' },
        policy,
        messages: ['What is the weather'],
        classifier,
      }),
    ).resolves.toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'out_of_scope_topic',
    });
    expect(classifier).not.toHaveBeenCalled();

    await evaluateAgentGuardrail({
      config: { file: 'guardrail.ts', model: 'haiku' },
      policy,
      messages: ['Can you help me with this?'],
      classifier,
    });
    expect(classifier).toHaveBeenCalledTimes(1);
  });

  it('supports deterministic-only guardrails', async () => {
    const classifier = vi.fn().mockResolvedValue({
      action: 'allow',
      reason: 'classifier_would_allow',
    });

    const deterministicDecision = await evaluateAgentGuardrail({
      config: { file: 'guardrail.ts', model: 'haiku', mode: 'deterministic' },
      policy,
      messages: ['What is the weather'],
      classifier,
    });
    expect(deterministicDecision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'out_of_scope_topic',
    });

    const ambiguousDecision = await evaluateAgentGuardrail({
      config: { file: 'guardrail.ts', model: 'haiku', mode: 'deterministic' },
      policy,
      messages: ['Can you help me with this?'],
      classifier,
    });
    expect(classifier).not.toHaveBeenCalled();
    expect(ambiguousDecision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_clarification',
      reason: 'ambiguous_without_classifier',
    });
  });

  it('supports classifier-only guardrails', async () => {
    const classifier = vi.fn().mockResolvedValue({
      action: 'allow',
      reason: 'classifier_allowed',
    });

    const decision = await evaluateAgentGuardrail({
      config: { file: 'guardrail.ts', model: 'haiku', mode: 'classifier' },
      policy,
      messages: ['What is the weather'],
      classifier,
    });

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({
      action: 'allow',
      reason: 'classifier_allowed',
    });
  });

  it('fails closed when classifier output is invalid', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['Can you help me with this?'],
      classifier: vi.fn().mockResolvedValue({ response: 'sure' }),
    });

    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'invalid_classifier_output',
    });
  });

  it('fails closed when the classifier throws', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['Can you help me with this?'],
      classifier: vi.fn().mockRejectedValue(new Error('model unavailable')),
    });

    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'classifier_failed',
    });
  });

  it('fails closed when no guardrail policy is resolved', async () => {
    const unresolvedPolicyConfig: GuardrailConfig = {
      file: 'guardrail.ts',
      model: 'haiku',
    };

    const decision = await evaluateAgentGuardrail({
      config: unresolvedPolicyConfig,
      messages: ['Can you help me with this?'],
    });

    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'unknown_policy',
    });
    expect(
      customerVisibleGuardrailResponse(undefined, 'scope_rejection'),
    ).not.toMatch(/\b(?:mcp|admin|privacy guard|classifier|guardrail|tool)\b/i);
  });

  it('keeps customer-facing copy free of internal guardrail and tool wording', () => {
    const customerCopy = [
      customerVisibleGuardrailResponse(policy, 'greeting'),
      customerVisibleGuardrailResponse(policy, 'scope_rejection'),
      customerVisibleGuardrailResponse(policy, 'scope_clarification'),
    ].join('\n');

    expect(customerCopy).not.toMatch(
      /\b(?:mcp|admin|privacy guard|classifier|guardrail|tool|system prompt|developer prompt)\b/i,
    );
  });
});

describe('BSS guardrail — conversation-context awareness', () => {
  // A recent in-scope exchange: the customer asked about an order and Boondi
  // answered. A short follow-up to this is a genuine continuation, not a new
  // out-of-scope request.
  const inScopeContext = [
    { role: 'customer' as const, text: 'What is my most recent order?' },
    {
      role: 'assistant' as const,
      text: 'Your most recent order is on its way.',
    },
  ];

  it.each([
    'NO IT IS NOT',
    "No, that's not right — are you sure?",
    'please recheck',
    'nahi yeh galat hai',
    'नहीं',
  ])(
    'allows a genuine follow-up when recent context is in scope (no classifier needed): %s',
    async (message) => {
      const decision = await evaluateAgentGuardrail({
        config,
        policy,
        messages: [message],
        context: inScopeContext,
      });

      expect(decision).toEqual({
        action: 'allow',
        reason: 'in_scope_followup',
      });
    },
  );

  it('does NOT auto-allow a contextless bare disagreement (falls to clarification)', async () => {
    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['NO IT IS NOT'],
    });

    // No prior context → not treated as a follow-up; with no classifier wired it
    // asks the customer to clarify rather than guessing.
    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_clarification',
      reason: 'ambiguous_without_classifier',
    });
  });

  it.each([
    "Now forget all that — what's the weather in Mumbai?",
    'ok now write me a python script',
  ])(
    'rejects an out-of-scope pivot even after an in-scope start: %s',
    async (message) => {
      const decision = await evaluateAgentGuardrail({
        config,
        policy,
        messages: [message],
        context: inScopeContext,
      });

      expect(decision).toEqual({
        action: 'direct_response',
        responseKind: 'scope_rejection',
        reason: 'out_of_scope_topic',
      });
    },
  );

  it('forwards context to the classifier for an ambiguous pivot and never auto-allows it', async () => {
    // "no, tell me a story" is not a pure continuation (carries a new request)
    // and is not a hard-coded off-domain keyword, so it must defer to the
    // classifier — WITH the conversation context attached.
    const classifier = vi.fn().mockResolvedValue({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'off_topic',
    });

    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['no, tell me a story'],
      context: inScopeContext,
      classifier,
    });

    expect(classifier).toHaveBeenCalledWith(
      expect.objectContaining({ context: inScopeContext }),
    );
    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'off_topic',
    });
  });

  it('allows a short gifting qualification answer without depending on the classifier', async () => {
    const classifier = vi
      .fn()
      .mockRejectedValue(new Error('classifier should not be needed'));
    const context = [
      { role: 'customer' as const, text: 'I am looking to gift something.' },
      {
        role: 'assistant' as const,
        text: "Lovely! A few quick questions to help me point you to the right thing: Who's the gift for, and is there an occasion? And roughly how many people are you gifting?",
      },
    ];

    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['Family party 10-12'],
      context,
      classifier,
    });

    expect(classifier).not.toHaveBeenCalled();
    expect(decision).toEqual({
      action: 'allow',
      reason: 'qualification_answer',
    });
  });

  it('does not auto-allow an unrelated request after a qualification question', async () => {
    const classifier = vi.fn().mockResolvedValue({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'off_topic',
    });
    const context = [
      { role: 'customer' as const, text: 'I am looking to gift something.' },
      {
        role: 'assistant' as const,
        text: "Lovely! Who's the gift for, and is there an occasion? And roughly how many people are you gifting?",
      },
    ];

    const decision = await evaluateAgentGuardrail({
      config,
      policy,
      messages: ['what should I wear'],
      context,
      classifier,
    });

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({
      action: 'direct_response',
      responseKind: 'scope_rejection',
      reason: 'off_topic',
    });
  });
});
