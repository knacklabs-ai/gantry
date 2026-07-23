import fs from 'node:fs';
import path from 'node:path';

import {
  bashExecutableName,
  type BashCommandLeaf,
} from './bash-command-parser.js';

export function outOfTrustedRootReason(
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
      return isPathLike(value) ? [value] : [];
    }),
  ];
}

// A value is treated as a path candidate when it is absolute, dot/tilde
// relative, OR a bare relative path containing a separator (e.g.
// `--git-dir=escape/.git`) — the last case still resolves against cwd and is
// symlink-canonicalized, so it cannot escape a trusted root. URLs (scheme://)
// are excluded so remotes and non-path options are not misread as paths.
function isPathLike(value: string): boolean {
  if (path.isAbsolute(value) || /^(?:\.{1,2}|~)(?:\/|$)/.test(value))
    return true;
  return value.includes('/') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function isTrustedPath(
  candidate: string,
  trustedRoots: readonly string[],
): boolean {
  const realCandidate = realResolve(candidate);
  return trustedRoots.some((root) => {
    const relative = path.relative(realResolve(root), realCandidate);
    return (
      relative === '' ||
      (!path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`))
    );
  });
}

// Canonicalize symlinks so a path lexically inside a trusted root cannot target
// outside it via a symlink. realpathSync throws on paths that do not exist yet
// (e.g. a clone target dir), so resolve the longest existing ancestor and
// re-append the not-yet-created tail.
function realResolve(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}
