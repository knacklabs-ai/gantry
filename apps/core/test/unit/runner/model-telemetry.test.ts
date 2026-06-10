import { describe, expect, it } from 'vitest';

import {
  formatRateLimitLogLine,
  rateLimitRuntimeEvent,
  sdkRateLimitSnapshot,
} from '@core/adapters/llm/anthropic-claude-agent/runner/model-telemetry.js';
import { RUNTIME_EVENT_TYPES } from '@core/domain/events/runtime-event-types.js';

const RATE_LIMIT_MESSAGE = {
  type: 'rate_limit_event',
  uuid: 'uuid-1',
  session_id: 'session-1',
  rate_limit_info: {
    status: 'allowed_warning',
    rateLimitType: 'five_hour',
    utilization: 0.91,
    surpassedThreshold: 0.9,
    resetsAt: 1781108400,
  },
};

describe('sdkRateLimitSnapshot', () => {
  it('extracts the account-pressure fields from an SDK rate_limit_event', () => {
    expect(sdkRateLimitSnapshot(RATE_LIMIT_MESSAGE)).toEqual({
      status: 'allowed_warning',
      rateLimitType: 'five_hour',
      utilization: 0.91,
      surpassedThreshold: 0.9,
      resetsAt: 1781108400,
    });
  });

  it('returns null for non rate-limit messages', () => {
    expect(sdkRateLimitSnapshot({ type: 'result' })).toBeNull();
    expect(sdkRateLimitSnapshot(null)).toBeNull();
    expect(sdkRateLimitSnapshot('rate_limit_event')).toBeNull();
  });

  it('returns null when rate_limit_info is missing or malformed', () => {
    expect(sdkRateLimitSnapshot({ type: 'rate_limit_event' })).toBeNull();
    expect(
      sdkRateLimitSnapshot({ type: 'rate_limit_event', rate_limit_info: 'hi' }),
    ).toBeNull();
  });

  it('returns null when no field has a recognized type', () => {
    expect(
      sdkRateLimitSnapshot({
        type: 'rate_limit_event',
        rate_limit_info: { status: 42, utilization: 'high' },
      }),
    ).toBeNull();
  });

  it('drops fields with unexpected types instead of failing', () => {
    expect(
      sdkRateLimitSnapshot({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          utilization: 'not-a-number',
          isUsingOverage: true,
        },
      }),
    ).toEqual({ status: 'allowed', isUsingOverage: true });
  });
});

describe('rateLimitRuntimeEvent', () => {
  it('builds a model.rate_limit runtime event carrying run context', () => {
    const snapshot = sdkRateLimitSnapshot(RATE_LIMIT_MESSAGE);
    expect(snapshot).not.toBeNull();
    const event = rateLimitRuntimeEvent(
      {
        appId: 'app-1',
        agentId: 'agent-1',
        runId: 'run-1',
        jobId: undefined,
        chatJid: 'wa:000000905',
        threadId: undefined,
      },
      snapshot!,
      'provider-session-1',
    );
    expect(event).toEqual({
      appId: 'app-1',
      agentId: 'agent-1',
      runId: 'run-1',
      conversationId: 'wa:000000905',
      actor: 'sdk',
      eventType: RUNTIME_EVENT_TYPES.MODEL_RATE_LIMIT,
      payload: {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.91,
        surpassedThreshold: 0.9,
        resetsAt: 1781108400,
        providerSessionId: 'provider-session-1',
      },
    });
  });

  it('omits absent context fields rather than sending empty strings', () => {
    const event = rateLimitRuntimeEvent(
      { chatJid: 'wa:000000905' },
      { status: 'allowed' },
      undefined,
    );
    expect(event).toEqual({
      conversationId: 'wa:000000905',
      actor: 'sdk',
      eventType: RUNTIME_EVENT_TYPES.MODEL_RATE_LIMIT,
      payload: { status: 'allowed' },
    });
  });
});

describe('formatRateLimitLogLine', () => {
  it('formats a single-line human-readable summary', () => {
    const snapshot = sdkRateLimitSnapshot(RATE_LIMIT_MESSAGE);
    expect(formatRateLimitLogLine(snapshot!)).toBe(
      'Rate limit [five_hour]: status=allowed_warning utilization=0.91 surpassedThreshold=0.9 resetsAt=1781108400',
    );
  });

  it('skips fields that are not present', () => {
    expect(formatRateLimitLogLine({ status: 'allowed' })).toBe(
      'Rate limit [unknown]: status=allowed',
    );
  });
});
