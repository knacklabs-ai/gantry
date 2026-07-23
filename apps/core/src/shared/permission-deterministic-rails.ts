import path from 'node:path';

import { decisionForMode } from '../domain/permission-decision.js';
import type {
  PermissionApprovalDecision,
  PermissionApprovalRequest,
} from '../domain/types.js';
import {
  evaluateAutoPermissionReadOnlyGate,
  type McpReadBinding,
} from './auto-permission-read-only-gate.js';
import {
  bashExecutableName,
  destructiveBashCommandHint,
  parseBashCommand,
  type BashCommandLeaf,
} from './bash-command-parser.js';
import { allProtectedPathMentions } from './tool-execution-protected-paths.js';

export interface PermissionDeterministicRailsInput {
  request: PermissionApprovalRequest;
  approvedCapabilityIds?: readonly string[];
  workspaceRoot?: string;
  trustedRoots?: readonly string[];
  reviewedMcpReadBindings?: readonly McpReadBinding[];
}

const SHELL_TOOLS = new Set(['Bash', 'RunCommand']);
const DESTRUCTIVE_EXECUTABLE =
  /^(?:dd|mkfs(?:\..+)?|rm|rmdir|shred|truncate|unlink)$/;
const PRIVILEGED_EXECUTABLE = /^(?:doas|launchctl|pkexec|su|sudo|systemctl)$/;
const CREDENTIAL_PATH = new RegExp(
  String.raw`(?:^|/)(?:\.ssh|\.aws|\.gnupg|\.azure|\.claude|\.codex|\.anthropic|\.config/(?:gh|github-copilot|codex|gcloud)|\.kube|\.docker|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.env(?:\.[^/]+)?|environ(?:ment)?|id_(?:dsa|ecdsa|ed25519|rsa)(?:\.pub)?|[^/]*(?:api[_-]?key|credential|private[_-]?key|secret|token)[^/]*|(?:[^/]*[_.-])?keys?(?:[_.-][^/]*)?|[^/]+\.(?:key|pem|p12|pfx))(?:/|$)`,
  'i',
);

export function evaluatePermissionDeterministicRails(
  input: PermissionDeterministicRailsInput,
): PermissionApprovalDecision | undefined {
  const { request } = input;
  if (inputIsIncomplete(request)) {
    return ask('Exact tool input is missing, sanitized, or altered.');
  }
  const toolInput = request.toolInput;
  if (!toolInput) return ask('Exact tool input is missing.');

  const readOnly = evaluateAutoPermissionReadOnlyGate({
    canonicalToolName: request.toolName,
    toolInput,
    approvedCapabilityIds: [...(input.approvedCapabilityIds ?? [])],
    workspaceRoot: input.workspaceRoot,
    reviewedMcpReadBindings: input.reviewedMcpReadBindings,
  });
  if (!SHELL_TOOLS.has(request.toolName)) {
    return readOnly.allowed ? allow(request, readOnly.reason) : undefined;
  }

  const command = commandText(toolInput);
  if (!command) return ask('Exact shell command input is missing.');
  const parsed = parseBashCommand(command);
  if (!parsed.ok) return ask(`Shell input is unsupported: ${parsed.reason}`);
  if (parsed.leaves.some(isInterpreterString)) {
    return ask('An interpreter string requires approval.');
  }
  if (
    destructiveBashCommandHint(command) ||
    parsed.leaves.some(isDestructiveLeaf)
  ) {
    return ask('Destructive command requires approval.');
  }
  if (uploadsLocalFile(command)) {
    return ask('Network command uploads local file content.');
  }
  if (containsProtectedPath(toolInput, command, parsed.leaves)) {
    return ask('Command references a credential, secret, or protected path.');
  }
  if (!readOnly.allowed) {
    const outside = outOfTrustedRootReason(
      parsed.leaves,
      input.workspaceRoot,
      input.trustedRoots ?? [],
    );
    if (outside) return ask(outside);
  }
  if (parsed.leaves.some(isPrivilegedLeaf)) {
    return ask('Privileged command requires approval.');
  }
  return readOnly.allowed ? allow(request, readOnly.reason) : undefined;
}

function inputIsIncomplete(request: PermissionApprovalRequest): boolean {
  const ipc = request as PermissionApprovalRequest & {
    toolInputRedactedPaths?: string[];
    toolInputTruncatedPaths?: string[];
  };
  return (
    !request.toolInput ||
    request.toolInputSanitized === true ||
    Boolean(request.toolInputSanitizedPaths?.length) ||
    Boolean(ipc.toolInputRedactedPaths?.length) ||
    Boolean(ipc.toolInputTruncatedPaths?.length)
  );
}

function isInterpreterString(leaf: BashCommandLeaf): boolean {
  const executable = bashExecutableName(leaf.argv[0] ?? '');
  const args = leaf.argv.slice(1);
  return (
    (executable === 'node' &&
      args.some((arg) => arg === '-e' || arg === '--eval')) ||
    ((executable === 'python' || executable === 'python3') &&
      args.includes('-c')) ||
    ((executable === 'perl' || executable === 'ruby') && args.includes('-e'))
  );
}

function isDestructiveLeaf(leaf: BashCommandLeaf): boolean {
  const executable = bashExecutableName(leaf.argv[0] ?? '');
  if (
    DESTRUCTIVE_EXECUTABLE.test(executable) ||
    leaf.redirects.some(({ destructive }) => destructive)
  ) {
    return true;
  }
  if (executable !== 'git') return false;
  const args = leaf.argv.slice(1);
  return (
    /\b(?:clean|reset|restore)\b/.test(args.join(' ')) ||
    args.includes('-D') ||
    (args.includes('checkout') && args.includes('--')) ||
    args.some((arg) => /^(?:-f|--force(?:-with-lease)?)$/.test(arg))
  );
}

function uploadsLocalFile(command: string): boolean {
  return (
    /\bcurl\b[\s\S]*(?:(?:-d|--data(?:-binary|-urlencode)?|--form)(?:=|\s)+@|(?:-F)[^\s]*=@|(?:-T|--upload-file)(?:=|\s)+\S+)/i.test(
      command,
    ) || /\bwget\b[\s\S]*--(?:post|body)-file(?:=|\s)+\S+/i.test(command)
  );
}

function containsProtectedPath(
  toolInput: Record<string, unknown>,
  command: string,
  leaves: readonly BashCommandLeaf[],
): boolean {
  if (allProtectedPathMentions(command).length > 0) return true;
  return [
    ...stringValues(toolInput),
    ...leaves.flatMap((leaf) => [
      ...leaf.argv,
      ...leaf.redirects.map(({ target }) => target),
    ]),
  ].some((value) => CREDENTIAL_PATH.test(value.replaceAll('\\', '/')));
}

function outOfTrustedRootReason(
  leaves: readonly BashCommandLeaf[],
  workspaceRoot: string | undefined,
  trustedRoots: readonly string[],
): string | undefined {
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    return 'Command working directory is unavailable or non-canonical.';
  }
  if (trustedRoots.length === 0) {
    return 'Command is outside the owner-declared trusted roots.';
  }
  for (const leaf of leaves) {
    const cwd = leafCwd(leaf, workspaceRoot);
    if (!isTrustedPath(cwd, trustedRoots)) {
      return `Command working directory is outside the owner-declared trusted roots: ${cwd}.`;
    }
    for (const candidate of pathCandidates(leaf)) {
      if (
        candidate.startsWith('~/') ||
        !isTrustedPath(path.resolve(cwd, candidate), trustedRoots)
      ) {
        return `Command target is outside the owner-declared trusted roots: ${candidate}.`;
      }
    }
  }
  return undefined;
}

function leafCwd(leaf: BashCommandLeaf, workspaceRoot: string): string {
  let cwd = path.resolve(workspaceRoot);
  if (bashExecutableName(leaf.argv[0] ?? '') !== 'git') return cwd;
  for (let index = 1; index < leaf.argv.length; index += 1) {
    if (leaf.argv[index] !== '-C') continue;
    if (leaf.argv[index + 1]) cwd = path.resolve(cwd, leaf.argv[index + 1]);
    index += 1;
  }
  return cwd;
}

function pathCandidates(leaf: BashCommandLeaf): string[] {
  return [
    ...leaf.redirects.map(({ target }) => target),
    ...leaf.argv.slice(1).flatMap((arg) => {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
      return path.isAbsolute(value) || /^(?:\.{1,2}|~)(?:\/|$)/.test(value)
        ? [value]
        : [];
    }),
  ];
}

function isTrustedPath(
  candidate: string,
  trustedRoots: readonly string[],
): boolean {
  return trustedRoots.some((root) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return (
      relative === '' ||
      (!path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`))
    );
  });
}

function isPrivilegedLeaf(leaf: BashCommandLeaf): boolean {
  return PRIVILEGED_EXECUTABLE.test(bashExecutableName(leaf.argv[0] ?? ''));
}

function commandText(input: Record<string, unknown>): string | undefined {
  const value = input.command ?? input.cmd;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(stringValues);
}

function ask(reason: string): PermissionApprovalDecision {
  return { approved: false, decidedBy: 'deterministic_rails', reason };
}

function allow(
  request: PermissionApprovalRequest,
  reason: string,
): PermissionApprovalDecision {
  return {
    ...decisionForMode(request, 'allow_once', 'deterministic_read_only'),
    reason,
  };
}
