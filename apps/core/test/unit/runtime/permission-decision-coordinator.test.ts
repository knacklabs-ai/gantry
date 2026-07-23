import { describe, expect, it, vi } from 'vitest';

import type { PermissionApprovalRequest } from '@core/domain/types.js';
import type { ToolPolicyDecision } from '@core/shared/tool-execution-policy-service.js';
import { buildSdkFilesystemSandbox } from '@core/adapters/llm/anthropic-claude-agent/runner/filesystem-sandbox.js';
import {
  coordinatePermissionDecision,
  permissionRunRestriction,
  unregisterPermissionRunRestriction,
} from '@core/runtime/permission-decision-coordinator.js';
import * as permissionCoordinator from '@core/runtime/permission-decision-coordinator.js';
import { registerWorkerPermissionRunRestriction } from '@core/runtime/agent-spawn-permission-run-restriction.js';
import { resolvePermissionIpcDecision } from '@core/runtime/ipc-permission-classifier-decision.js';

const GATES = [
  'SDK worker',
  'DeepAgents shell',
  'DeepAgents third-party MCP',
  'DeepAgents facade',
  'inline core tool',
  'inline third-party MCP',
] as const;

const request: PermissionApprovalRequest = {
  requestId: 'permission-test',
  sourceAgentFolder: 'main_agent',
  toolName: 'FileRead',
  toolInput: { path: 'README.md' },
};

const reviewedAllow: ToolPolicyDecision = {
  status: 'allow',
  reason: 'Allowed by reviewed rule FileRead.',
  audit: {
    category: 'tool_execution',
    origin: 'host',
    toolKind: 'file',
    toolName: 'FileRead',
    mutationIntent: 'read',
  },
};

describe('coordinatePermissionDecision', () => {
  it.each(
    GATES.flatMap((gate) => [
      {
        gate,
        authority: 'hard-deny',
        input: {
          hardDenyReason: 'hard denied',
          accessPreset: 'locked' as const,
          fixedImageRestricted: true,
          reviewedRuleDecision: reviewedAllow,
        },
        expected: { approved: false, decidedBy: 'hard_deny' },
      },
      {
        gate,
        authority: 'locked-preset',
        input: {
          accessPreset: 'locked' as const,
          fixedImageRestricted: true,
          reviewedRuleDecision: reviewedAllow,
        },
        expected: { approved: false, decidedBy: 'locked_preset' },
      },
      {
        gate,
        authority: 'fixed-image',
        input: {
          fixedImageRestricted: true,
          reviewedRuleDecision: reviewedAllow,
        },
        expected: { approved: false, decidedBy: 'fixed_image' },
      },
      {
        gate,
        authority: 'reviewed-rule-allow',
        input: { reviewedRuleDecision: reviewedAllow },
        expected: { approved: true, decidedBy: 'reviewed_rule' },
      },
    ]),
  )('$gate: $authority beats the otherwise-allowing tail', async (testCase) => {
    const tail = vi.fn(async () => ({
      approved: true,
      mode: 'allow_once' as const,
      decidedBy: 'tail',
    }));
    await expect(
      coordinatePermissionDecision({
        request: { ...request },
        ...testCase.input,
        tail,
      }),
    ).resolves.toMatchObject(testCase.expected);
    expect(tail).not.toHaveBeenCalled();
  });

  it('routes an injected ASK rail to the classifier/human tail', async () => {
    const railRequest = { ...request };
    const tailDecision = {
      approved: true,
      mode: 'allow_once' as const,
      decidedBy: 'human',
    };
    const tail = vi.fn(async () => tailDecision);
    const deterministicRails = vi.fn(() => ({
      railOutcome: 'ask' as const,
      reason: 'rail asks',
    }));
    await expect(
      coordinatePermissionDecision({
        request: railRequest,
        deterministicRails,
        tail,
      }),
    ).resolves.toEqual(tailDecision);
    expect(deterministicRails).toHaveBeenCalledOnce();
    expect(tail).toHaveBeenCalledOnce();
    expect(railRequest.decisionReason).toBe('rail asks');
  });

  it('routes a default ASK rail to the classifier/human tail', async () => {
    const tailDecision = {
      approved: false,
      mode: 'cancel' as const,
      decidedBy: 'human',
    };
    const tail = vi.fn(async () => tailDecision);
    const railRequest = {
      ...request,
      toolName: 'RunCommand',
      toolInput: { command: 'rm -rf ./build' },
    };
    await expect(
      coordinatePermissionDecision({
        request: railRequest,
        tail,
      }),
    ).resolves.toEqual(tailDecision);
    expect(tail).toHaveBeenCalledOnce();
    expect(railRequest.decisionReason).toContain('Destructive');
  });

  it.each([
    {
      label: 'DENY',
      railDecision: {
        railOutcome: 'deny' as const,
        approved: false,
        mode: 'cancel' as const,
        decidedBy: 'deterministic_rails',
        reason: 'rail denies',
      },
    },
    {
      label: 'ALLOW',
      railDecision: {
        railOutcome: 'allow' as const,
        approved: true,
        mode: 'allow_once' as const,
        decidedBy: 'deterministic_read_only',
        reason: 'rail allows',
      },
    },
  ])('terminates on an injected $label rail', async ({ railDecision }) => {
    const tail = vi.fn();
    await expect(
      coordinatePermissionDecision({
        request: { ...request },
        deterministicRails: () => railDecision,
        tail,
      }),
    ).resolves.toEqual(railDecision);
    expect(tail).not.toHaveBeenCalled();
  });

  it('routes credential-read ASK rails to the tail with the direct SDK escape hatch disabled', async () => {
    const sdkSandbox = buildSdkFilesystemSandbox(['~/.ssh']);
    const tailDecision = {
      approved: false,
      mode: 'cancel' as const,
      decidedBy: 'human',
    };
    const tail = vi.fn(async () => tailDecision);
    const railRequest = {
      ...request,
      toolName: 'RunCommand',
      toolInput: { command: 'cat ~/.ssh/id_rsa' },
    };

    expect(sdkSandbox.allowUnsandboxedCommands).toBe(false);
    expect(sdkSandbox.filesystem?.denyRead).toEqual(
      expect.arrayContaining([expect.stringMatching(/\/\.ssh$/)]),
    );
    await expect(
      coordinatePermissionDecision({
        request: railRequest,
        tail,
      }),
    ).resolves.toEqual(tailDecision);
    expect(tail).toHaveBeenCalledOnce();
    expect(railRequest.decisionReason).toContain('credential');
  });

  it.each([
    [
      'allow',
      {
        approved: true,
        mode: 'allow_once' as const,
        decidedBy: 'classifier_cache',
      },
    ],
    [
      'deny',
      {
        approved: false,
        mode: 'cancel' as const,
        decidedBy: 'classifier_cache',
      },
    ],
  ])(
    're-validates a cached %s against current rails',
    async (_label, cachedDecision) => {
      const tail = vi.fn(async () => cachedDecision);
      const shellRequest = {
        ...request,
        toolName: 'RunCommand',
        toolInput: { command: 'git status' },
      };

      await expect(
        coordinatePermissionDecision({
          request: { ...shellRequest },
          deterministicRailsInput: {
            workspaceRoot: '/workspace',
            trustedRoots: ['/workspace'],
          },
          tail,
        }),
      ).resolves.toEqual(cachedDecision);

      const outsideRequest = { ...shellRequest };
      await expect(
        coordinatePermissionDecision({
          request: outsideRequest,
          deterministicRailsInput: {
            workspaceRoot: '/workspace',
            trustedRoots: [],
          },
          tail,
        }),
      ).resolves.toEqual(cachedDecision);
      expect(outsideRequest.decisionReason).toContain('outside');
      expect(tail).toHaveBeenCalledTimes(2);
    },
  );

  it('returns a cached classifier allow WITHOUT reaching the tail (cache hit)', async () => {
    const tail = vi.fn();
    const getClassifierVerdict = vi.fn(async () => ({
      decision: 'allow' as const,
      reason: 'cached allow',
    }));
    await expect(
      coordinatePermissionDecision({
        request: { ...request },
        effectHash: 'effect-hash-1',
        decisionMemory: { getClassifierVerdict } as never,
        deterministicRails: () => undefined,
        tail,
      }),
    ).resolves.toMatchObject({
      approved: true,
      mode: 'allow_once',
      decidedBy: 'cached_classifier_verdict',
      reason: 'cached allow',
    });
    expect(getClassifierVerdict).toHaveBeenCalledWith({
      appId: 'default',
      agentFolder: 'main_agent',
      effectHash: 'effect-hash-1',
    });
    expect(tail).not.toHaveBeenCalled();
  });

  it('lets an ASK rail override a cached allow WITHOUT reading the cache', async () => {
    const tailDecision = {
      approved: false,
      mode: 'cancel' as const,
      decidedBy: 'human',
    };
    const tail = vi.fn(async () => tailDecision);
    const getClassifierVerdict = vi.fn(async () => ({
      decision: 'allow' as const,
      reason: 'stale cached allow',
    }));
    const railRequest = { ...request };
    await expect(
      coordinatePermissionDecision({
        request: railRequest,
        effectHash: 'effect-hash-1',
        decisionMemory: { getClassifierVerdict } as never,
        deterministicRails: () => ({
          railOutcome: 'ask' as const,
          reason: 'rail now asks',
        }),
        tail,
      }),
    ).resolves.toEqual(tailDecision);
    expect(getClassifierVerdict).not.toHaveBeenCalled();
    expect(tail).toHaveBeenCalledOnce();
    expect(railRequest.decisionReason).toBe('rail now asks');
  });

  it('lets a locked preset outrank a cached allow (lock beats cache)', async () => {
    const tail = vi.fn();
    const getClassifierVerdict = vi.fn(async () => ({
      decision: 'allow' as const,
      reason: 'cached allow',
    }));
    await expect(
      coordinatePermissionDecision({
        request: { ...request },
        accessPreset: 'locked',
        effectHash: 'effect-hash-1',
        decisionMemory: { getClassifierVerdict } as never,
        deterministicRails: () => undefined,
        tail,
      }),
    ).resolves.toMatchObject({ approved: false, decidedBy: 'locked_preset' });
    expect(getClassifierVerdict).not.toHaveBeenCalled();
    expect(tail).not.toHaveBeenCalled();
  });

  it('skips the cache entirely when the effect hash is undefined', async () => {
    const tailDecision = {
      approved: false,
      mode: 'cancel' as const,
      decidedBy: 'human',
    };
    const tail = vi.fn(async () => tailDecision);
    const getClassifierVerdict = vi.fn();
    await expect(
      coordinatePermissionDecision({
        request: { ...request },
        effectHash: undefined,
        decisionMemory: { getClassifierVerdict } as never,
        deterministicRails: () => undefined,
        tail,
      }),
    ).resolves.toEqual(tailDecision);
    expect(getClassifierVerdict).not.toHaveBeenCalled();
    expect(tail).toHaveBeenCalledOnce();
  });

  it('spawn registration stores and removes the host restriction by agent/run key', () => {
    const key = {
      sourceAgentFolder: 'main_agent',
      responseKeyId: 'response-key-run-1',
    };
    registerWorkerPermissionRunRestriction({
      ...key,
      hideAuthorityTools: true,
    });
    expect(permissionRunRestriction(key)).toEqual({
      hideAuthorityTools: true,
    });
    unregisterPermissionRunRestriction(key);
    expect(permissionRunRestriction(key)).toBeUndefined();
  });

  it('reaches the coordinator exactly once for an SDK worker IPC decision', async () => {
    const coordinate = vi.spyOn(
      permissionCoordinator,
      'coordinatePermissionDecision',
    );
    await resolvePermissionIpcDecision({
      request: {
        requestId: 'sdk-worker-once',
        sourceAgentFolder: 'main_agent',
        toolName: 'Bash',
        toolInput: { command: 'echo hello' },
      },
      sourceAgentFolder: 'main_agent',
      deps: {
        conversationRoutes: () => ({}),
        requestPermissionApproval: vi.fn(async () => ({
          approved: false,
          mode: 'cancel' as const,
        })),
        getPermissionRuntimeSettings: () => ({
          agents: { main_agent: { permissionMode: 'ask' as const } },
          permissions: { autoMode: {} },
          memory: { llm: { models: { extractor: 'sonnet' } } },
        }),
      } as never,
    });
    expect(coordinate).toHaveBeenCalledTimes(1);
    coordinate.mockRestore();
  });

  it('consults the host registry before the IPC tail', async () => {
    const key = {
      sourceAgentFolder: 'main_agent',
      responseKeyId: 'fixed-image-run',
    };
    registerWorkerPermissionRunRestriction({
      ...key,
      hideAuthorityTools: true,
    });
    const requestPermissionApproval = vi.fn();
    await expect(
      resolvePermissionIpcDecision({
        request: {
          requestId: 'fixed-image-request',
          responseKeyId: key.responseKeyId,
          sourceAgentFolder: key.sourceAgentFolder,
          toolName: 'FileRead',
          toolInput: { path: 'README.md' },
        },
        sourceAgentFolder: key.sourceAgentFolder,
        deps: {
          conversationRoutes: () => ({}),
          requestPermissionApproval,
          getPermissionRuntimeSettings: () => ({
            agents: {},
            permissions: { autoMode: {} },
            memory: { llm: { models: { extractor: 'sonnet' } } },
          }),
        } as never,
      }),
    ).resolves.toMatchObject({
      approved: false,
      decidedBy: 'fixed_image',
    });
    expect(requestPermissionApproval).not.toHaveBeenCalled();
    unregisterPermissionRunRestriction(key);
  });
});
