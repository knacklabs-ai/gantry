import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAgentSessionRepository } from '@core/domain/repositories/ops-repo.js';
import {
  buildAgentFolderSkillContextBlock,
  createRuntimeResultSummaryAccumulator,
  completeSuccessfulRuntimeSessionRun,
  completeFailedRuntimeSessionRun,
  RUNTIME_RESULT_SUMMARY_MAX_CHARS,
  summarizeRuntimeResultForPersistence,
  truncateRuntimeResultSummary,
} from '@core/runtime/session-resume-runtime.js';

describe('session-resume-runtime', () => {
  it('summarizes progressive agent-folder skills without injecting their body', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gantry-agent-skill-context-'),
    );
    try {
      const skillDir = path.join(tempRoot, 'skills', 'boondi-gifting');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: boondi-gifting',
          'description: Use for gifting recommendations.',
          'disclosure: progressive',
          '---',
          '',
          '# Secret body',
          'PRE-06 to PRE-09 runtime gifting projection',
        ].join('\n'),
      );

      const block = await buildAgentFolderSkillContextBlock({
        agentFolderPath: tempRoot,
        skillIds: ['boondi-gifting'],
      });

      expect(block).toContain('[[AGENT_FOLDER_SKILLS_AVAILABLE_THIS_SESSION]]');
      expect(block).toContain('id: boondi-gifting');
      expect(block).toContain('description: Use for gifting recommendations.');
      expect(block).toContain('provider-native Skill(boondi-gifting) tool');
      expect(block).toContain('do not answer from general memory');
      expect(block).toContain('selected skills are not MCP servers');
      expect(block).toContain(
        'Do not use Gantry mcp_list_tools, mcp_call_tool',
      );
      expect(block).not.toContain(
        'PRE-06 to PRE-09 runtime gifting projection',
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('summarizes multiple progressive agent-folder skills without injecting bodies', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gantry-agent-skill-context-'),
    );
    try {
      const skillSpecs = [
        {
          id: 'boondi-gifting',
          description: 'Use for BSS gifting recommendations.',
          body: 'PRE-06 to PRE-09 runtime gifting projection',
        },
        {
          id: 'boondi-orders',
          description: 'Use for BSS order status and complaints.',
          body: 'DEL-01 runtime orders projection',
        },
        {
          id: 'boondi-store-aggregator',
          description: 'Use for BSS stores and aggregator orders.',
          body: 'CAFE and AGG runtime store projection',
        },
      ];

      for (const skill of skillSpecs) {
        const skillDir = path.join(tempRoot, 'skills', skill.id);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, 'SKILL.md'),
          [
            '---',
            `name: ${skill.id}`,
            `description: ${skill.description}`,
            'disclosure: progressive',
            '---',
            '',
            `# ${skill.id}`,
            skill.body,
          ].join('\n'),
        );
      }

      const block = await buildAgentFolderSkillContextBlock({
        agentFolderPath: tempRoot,
        skillIds: skillSpecs.map((skill) => skill.id),
      });

      for (const skill of skillSpecs) {
        expect(block).toContain(`id: ${skill.id}`);
        expect(block).toContain(skill.description);
        expect(block).toContain(`provider-native Skill(${skill.id}) tool`);
        expect(block).not.toContain(skill.body);
      }
      expect(block).not.toContain('boondi-kb');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('redacts provider session handles from persisted summaries', () => {
    const summary = summarizeRuntimeResultForPersistence(
      [
        'framed {"newSessionId":"json-new-handle","providerSessionId":"provider-session:json-secret","externalSessionId":"claude-session-json-secret","session_id":"snake-json-handle"}',
        'sessionId=session-inline-handle',
        'latestProviderSessionId latest-whitespace-handle',
        'provider-session:standalone-secret',
        'claude-session-standalone-secret',
      ].join(' '),
    ) as string;

    expect(summary).toContain('[REDACTED]');
    expect(summary).not.toContain('json-new-handle');
    expect(summary).not.toContain('provider-session:json-secret');
    expect(summary).not.toContain('claude-session-json-secret');
    expect(summary).not.toContain('snake-json-handle');
    expect(summary).not.toContain('session-inline-handle');
    expect(summary).not.toContain('latest-whitespace-handle');
    expect(summary).not.toContain('provider-session:standalone-secret');
    expect(summary).not.toContain('claude-session-standalone-secret');
  });

  it('caps oversized failed agent run error summaries before persistence', async () => {
    const completeSessionAgentRun = vi.fn().mockResolvedValue(undefined);
    const ops = {
      completeSessionAgentRun,
    } as unknown as RuntimeAgentSessionRepository;
    const errorSummary = `HEAD-START${'x'.repeat(
      RUNTIME_RESULT_SUMMARY_MAX_CHARS + 250,
    )}TAIL-END`;

    await completeFailedRuntimeSessionRun({
      ops,
      runId: 'run-1',
      errorSummary,
    });

    expect(completeSessionAgentRun).toHaveBeenCalledTimes(1);
    const completion = completeSessionAgentRun.mock.calls[0][0];
    const summary = completion.errorSummary as string;
    expect(summary.length).toBeLessThanOrEqual(
      RUNTIME_RESULT_SUMMARY_MAX_CHARS,
    );
    expect(summary).toMatch(/^\[output truncated; showing tail\]\n/);
    expect(summary).not.toContain('HEAD-START');
    expect(summary.endsWith('TAIL-END')).toBe(true);
  });

  it('does not emit marker-only summaries when max chars cannot hold marker and content', () => {
    const accumulator = createRuntimeResultSummaryAccumulator({ maxChars: 0 });
    accumulator.append('important body');

    expect(accumulator.snapshot()).toBeNull();
  });

  it('keeps content instead of marker-only summaries for tiny truncation limits', () => {
    expect(truncateRuntimeResultSummary('important body', 8)).toBe(
      'important body',
    );
    expect(truncateRuntimeResultSummary('important body', 8)).not.toBe(
      '[output truncated; showing tail]',
    );
  });

  it('redacts completion summaries before storing successful runs', async () => {
    const completeSessionAgentRun = vi.fn().mockResolvedValue(undefined);
    const ops = {
      completeSessionAgentRun,
    } as unknown as RuntimeAgentSessionRepository;

    await completeSuccessfulRuntimeSessionRun({
      ops,
      group: { name: 'Main', folder: 'main_agent' } as never,
      runId: 'run-2',
      result:
        'ok {"newSessionId":"json-success-handle"} sessionId=session-inline-success provider-session:standalone-success',
    });

    expect(completeSessionAgentRun).toHaveBeenCalledTimes(1);
    const completion = completeSessionAgentRun.mock.calls[0][0];
    const summary = completion.resultSummary as string;
    expect(summary).toContain('[REDACTED]');
    expect(summary).not.toContain('json-success-handle');
    expect(summary).not.toContain('session-inline-success');
    expect(summary).not.toContain('provider-session:standalone-success');
  });

  it('redacts provider resume handles before storing failed runs', async () => {
    const completeSessionAgentRun = vi.fn().mockResolvedValue(undefined);
    const ops = {
      completeSessionAgentRun,
    } as unknown as RuntimeAgentSessionRepository;

    await completeFailedRuntimeSessionRun({
      ops,
      runId: 'run-failed-redaction',
      errorSummary:
        'failed latestProviderSessionId=latest-failed provider-session:standalone-failed {"externalSessionId":"claude-session-failed"}',
    });

    expect(completeSessionAgentRun).toHaveBeenCalledTimes(1);
    const completion = completeSessionAgentRun.mock.calls[0][0];
    const summary = completion.errorSummary as string;
    expect(summary).toContain('[REDACTED]');
    expect(summary).not.toContain('latest-failed');
    expect(summary).not.toContain('provider-session:standalone-failed');
    expect(summary).not.toContain('claude-session-failed');
  });

  it('does not throw when failed run bookkeeping cannot be persisted', async () => {
    const completeSessionAgentRun = vi
      .fn()
      .mockRejectedValue(new Error('database unavailable'));
    const ops = {
      completeSessionAgentRun,
    } as unknown as RuntimeAgentSessionRepository;

    await expect(
      completeFailedRuntimeSessionRun({
        ops,
        runId: 'run-failed-bookkeeping',
        errorSummary: 'permission denied',
      }),
    ).resolves.toBeUndefined();

    expect(completeSessionAgentRun).toHaveBeenCalledWith({
      runId: 'run-failed-bookkeeping',
      status: 'failed',
      errorSummary: 'permission denied',
    });
  });

  it('does not throw when successful run bookkeeping cannot be persisted', async () => {
    const completeSessionAgentRun = vi
      .fn()
      .mockRejectedValue(new Error('database unavailable'));
    const ops = {
      completeSessionAgentRun,
    } as unknown as RuntimeAgentSessionRepository;

    await expect(
      completeSuccessfulRuntimeSessionRun({
        ops,
        group: { name: 'Main', folder: 'main_agent' } as never,
        runId: 'run-success-bookkeeping',
        result: 'done',
      }),
    ).resolves.toBeUndefined();

    expect(completeSessionAgentRun).toHaveBeenCalledWith({
      runId: 'run-success-bookkeeping',
      status: 'completed',
      resultSummary: 'done',
    });
  });

  it('does not persist provider resume handles under the job-owned session scope', async () => {
    const setSession = vi.fn().mockResolvedValue(true);
    const ops = {
      setSession,
    } as unknown as RuntimeAgentSessionRepository;

    await completeSuccessfulRuntimeSessionRun({
      ops,
      group: { name: 'Scheduler', folder: 'scheduler_agent' } as never,
      chatJid: 'tg:scheduler',
      threadId: 'topic-1',
      conversationKind: 'channel',
      jobId: 'job-1',
      agentSessionId: 'agent-session:job-1',
      providerSessionId: 'claude-session-job-1',
      result: 'ok',
    });

    expect(setSession).not.toHaveBeenCalled();
  });
});
