import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Loads the Gantry runtime env file (<GANTRY_HOME>/.env) into process.env,
// mirroring how core resolves and reads it (apps/core/src/shared/gantry-home.ts
// + env-runtime-secret-provider.ts). Resolution order:
//   explicit override  >  $GANTRY_HOME  >  ~/gantry   (with ~ expansion).
// Values never overwrite already-set process.env keys, so the real process.env
// and node's --env-file still win. Kept self-contained per package (no
// cross-package import), matching the rest of this connector.

const SEARCH_FILE = '.env';

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveGantryHome(override?: string): string {
  const raw =
    override?.trim() ||
    process.env.GANTRY_HOME?.trim() ||
    path.join(os.homedir(), 'gantry');
  return path.resolve(expandHome(raw));
}

export function loadRuntimeEnv(homeOverride?: string): string | null {
  const envPath = path.join(resolveGantryHome(homeOverride), SEARCH_FILE);
  if (!fs.existsSync(envPath)) return null;
  applyEnvFile(envPath);
  return envPath;
}

function applyEnvFile(filePath: string): void {
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
