import fs from 'node:fs';
import path from 'node:path';

import { resolveGroupFolderPath } from './group-folder.js';

/**
 * Reads an agent-owned content file from the agent's RUNTIME folder
 * (`<AGENTS_DIR>/<folder>/<filename>`). This is how an agent supplies its own
 * prompts/content (the guardrail plugin, the memory-extraction prompt, etc.)
 * without that content living in Gantry core — the framework provides the
 * mechanism, the runtime agent owns the content.
 *
 * Utilization is RUNTIME-ONLY: the path is always resolved under `AGENTS_DIR`
 * (`GANTRY_HOME/agents`); the in-repo copy + symlink is a developer-versioning
 * convenience the running code never sees.
 *
 * `filename` may include a sub-folder (e.g. `memory_extractor/memory_extractor.md`);
 * the resolved path is verified to stay INSIDE the agent folder, so a traversal
 * attempt returns `null` rather than reading outside it.
 *
 * Best-effort by design: a missing file, an invalid folder name, a path that
 * escapes the folder, or a blank file returns `null` so callers can fall back to
 * a generic in-core default. IO errors other than "not found" propagate (they
 * indicate a real problem worth surfacing, e.g. a permission fault).
 */
export function readAgentRuntimeFile(
  folder: string,
  filename: string,
): string | null {
  let dir: string;
  try {
    dir = resolveGroupFolderPath(folder);
    // eslint-disable-next-line no-catch-all/no-catch-all -- An invalid/unsafe folder name means "no agent content"; callers fall back to the generic default.
  } catch {
    return null;
  }
  // Containment: the resolved file must stay within the agent folder.
  const target = path.resolve(dir, filename);
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
