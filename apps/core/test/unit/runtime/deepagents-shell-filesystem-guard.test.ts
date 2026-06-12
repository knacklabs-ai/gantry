import { describe, expect, it } from 'vitest';

import {
  DEEPAGENTS_ENFORCING_SANDBOX_REQUIRED_MESSAGE,
  DEEPAGENTS_SHELL_EXECUTION_DISABLED_MESSAGE,
  deepAgentsEnforcingSandboxGuard,
  deepAgentsShellExecutionGuard,
  deepAgentsShellFilesystemGuard,
  requestsShellOrFilesystemAuthority,
} from '@core/runtime/deepagents-shell-filesystem-guard.js';
import type { RuntimeSecurityEnv } from '@core/shared/security-posture.js';
import {
  DEEPAGENTS_ENGINE,
  DEFAULT_AGENT_ENGINE,
} from '@core/shared/agent-engine.js';

const SAFE_LOCAL_ENV: RuntimeSecurityEnv = {};
const PRODUCTION_ENV: RuntimeSecurityEnv = { NODE_ENV: 'production' };

describe('deepAgentsShellFilesystemGuard', () => {
  describe('requestsShellOrFilesystemAuthority', () => {
    it('detects bare RunCommand, scoped RunCommand, and raw Bash', () => {
      expect(requestsShellOrFilesystemAuthority(['RunCommand'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['RunCommand(npm test)'])).toBe(
        true,
      );
      expect(requestsShellOrFilesystemAuthority(['Bash'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['Bash(ls *)'])).toBe(true);
    });

    it('detects Gantry facade filesystem tools and raw provider-native file tools', () => {
      expect(requestsShellOrFilesystemAuthority(['FileWrite'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['FileRead'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['FileEdit'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['FileSearch'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['Write'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['Read'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['Edit'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['MultiEdit'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['Glob'])).toBe(true);
      expect(requestsShellOrFilesystemAuthority(['Grep'])).toBe(true);
    });

    it('does not trip on web/search/browser facade tools', () => {
      expect(
        requestsShellOrFilesystemAuthority(['WebSearch', 'WebRead', 'Browser']),
      ).toBe(false);
      expect(requestsShellOrFilesystemAuthority([])).toBe(false);
      expect(requestsShellOrFilesystemAuthority(undefined)).toBe(false);
    });
  });

  describe('deepAgentsShellExecutionGuard', () => {
    it('returns the EXACT shell-execution copy for a DeepAgents shell request', () => {
      expect(
        deepAgentsShellExecutionGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['RunCommand(npm test)'],
        }),
      ).toBe(DEEPAGENTS_SHELL_EXECUTION_DISABLED_MESSAGE);
      expect(DEEPAGENTS_SHELL_EXECUTION_DISABLED_MESSAGE).toBe(
        'DeepAgents shell execution is disabled until Gantry can route it through RunCommand policy.',
      );
    });

    it('returns the EXACT shell-execution copy for a DeepAgents filesystem request', () => {
      expect(
        deepAgentsShellExecutionGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['FileWrite'],
        }),
      ).toBe(DEEPAGENTS_SHELL_EXECUTION_DISABLED_MESSAGE);
    });

    it('does not block the default (Anthropic SDK) engine', () => {
      expect(
        deepAgentsShellExecutionGuard({
          engine: DEFAULT_AGENT_ENGINE,
          toolPolicyRules: ['RunCommand(npm test)', 'FileWrite'],
        }),
      ).toBeNull();
    });

    it('does not block a DeepAgents run with no shell/fs authority', () => {
      expect(
        deepAgentsShellExecutionGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['WebSearch', 'WebRead'],
        }),
      ).toBeNull();
    });
  });

  describe('deepAgentsEnforcingSandboxGuard', () => {
    it('returns the EXACT enforcing-sandbox copy under production posture even with sandbox_runtime', () => {
      expect(
        deepAgentsEnforcingSandboxGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['FileWrite'],
          securityEnv: PRODUCTION_ENV,
          sandboxProvider: 'sandbox_runtime',
        }),
      ).toBe(DEEPAGENTS_ENFORCING_SANDBOX_REQUIRED_MESSAGE);
      expect(DEEPAGENTS_ENFORCING_SANDBOX_REQUIRED_MESSAGE).toBe(
        'DeepAgents requires an enforcing sandbox before shell or filesystem tools can be enabled in this deployment mode.',
      );
    });

    it('returns the enforcing-sandbox copy when the sandbox provider is not enforcing (direct), local posture', () => {
      expect(
        deepAgentsEnforcingSandboxGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['RunCommand(npm test)'],
          securityEnv: SAFE_LOCAL_ENV,
          sandboxProvider: 'direct',
        }),
      ).toBe(DEEPAGENTS_ENFORCING_SANDBOX_REQUIRED_MESSAGE);
    });

    it('passes when sandbox_runtime + local posture + shell/fs requested (future enablement path)', () => {
      expect(
        deepAgentsEnforcingSandboxGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['RunCommand(npm test)'],
          securityEnv: SAFE_LOCAL_ENV,
          sandboxProvider: 'sandbox_runtime',
        }),
      ).toBeNull();
    });

    it('does not apply when no shell/fs authority is requested', () => {
      expect(
        deepAgentsEnforcingSandboxGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['WebSearch'],
          securityEnv: PRODUCTION_ENV,
          sandboxProvider: 'direct',
        }),
      ).toBeNull();
    });

    it('does not apply to the default (Anthropic SDK) engine', () => {
      expect(
        deepAgentsEnforcingSandboxGuard({
          engine: DEFAULT_AGENT_ENGINE,
          toolPolicyRules: ['RunCommand(npm test)'],
          securityEnv: PRODUCTION_ENV,
          sandboxProvider: 'direct',
        }),
      ).toBeNull();
    });
  });

  describe('combined guard ordering', () => {
    it('v1: shell-execution guard fires FIRST, masking the enforcing-sandbox copy', () => {
      // Production + direct sandbox would trip BOTH guards; v1 ordering surfaces
      // the shell-execution-disabled copy because that guard runs first.
      expect(
        deepAgentsShellFilesystemGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['RunCommand(npm test)'],
          securityEnv: PRODUCTION_ENV,
          sandboxProvider: 'direct',
        }),
      ).toBe(DEEPAGENTS_SHELL_EXECUTION_DISABLED_MESSAGE);
    });

    it('combined guard returns null for a safe DeepAgents run with no shell/fs authority', () => {
      expect(
        deepAgentsShellFilesystemGuard({
          engine: DEEPAGENTS_ENGINE,
          toolPolicyRules: ['WebSearch', 'WebRead'],
          securityEnv: PRODUCTION_ENV,
          sandboxProvider: 'direct',
        }),
      ).toBeNull();
    });

    it('combined guard returns null for the default engine regardless of rules/posture', () => {
      expect(
        deepAgentsShellFilesystemGuard({
          engine: DEFAULT_AGENT_ENGINE,
          toolPolicyRules: ['RunCommand(npm test)', 'FileWrite'],
          securityEnv: PRODUCTION_ENV,
          sandboxProvider: 'direct',
        }),
      ).toBeNull();
    });
  });
});
