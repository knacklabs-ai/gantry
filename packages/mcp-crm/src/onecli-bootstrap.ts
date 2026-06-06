import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OneCLI } from '@onecli-sh/sdk';

// The model-runtime credential identifier OneCLI hands model creds for (same one
// Gantry core uses).
const MODEL_IDENTIFIER = 'gantry-model-access';

let loaded = false;

// Fetch the model-runtime credential from the OneCLI broker the same way Gantry
// core does, and project it into THIS process's env: CLAUDE_CODE_OAUTH_TOKEN plus
// the proxy + CA the credential is fenced behind. The extractor passes exactly
// these to the Claude Agent SDK's query(), which spawns the Claude CLI — and that
// CLI (a fresh Node process) reads NODE_USE_ENV_PROXY + NODE_EXTRA_CA_CERTS at its
// own startup. The connector process itself makes no outbound model HTTPS, so it
// does NOT need to re-exec to pick up proxy env at startup — we just set the vars
// here and hand them to the child. No-op when already loaded, when a raw
// ANTHROPIC_API_KEY is set (the CLI uses that directly), or when the broker is
// unreachable (the extractor then self-disables).
export async function bootstrapOneCliCredentials(
  log: (msg: string, extra?: Record<string, unknown>) => void = () => undefined,
): Promise<void> {
  if (loaded) return;
  if (process.env.ANTHROPIC_API_KEY?.trim()) return; // explicit raw key wins
  const url = process.env.ONECLI_URL?.trim() || 'http://localhost:10254';

  let env: Record<string, string> = {};
  let ca: string | undefined;
  try {
    const cfg = await new OneCLI({ url, timeout: 10_000 }).getContainerConfig(
      MODEL_IDENTIFIER,
    );
    env = cfg.env || {};
    ca = cfg.caCertificate || undefined;
  } catch (err) {
    log('onecli_broker_unreachable', {
      url,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const token = env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_AUTH_TOKEN;
  if (!token) {
    log('onecli_no_model_token');
    return;
  }
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;

  // The connector runs on the HOST; the broker returns the container-facing proxy
  // host. Rewrite to localhost so the spawned CLI can reach it from the host.
  const rawProxy = env.HTTPS_PROXY || env.HTTP_PROXY;
  if (rawProxy) {
    const proxy = rawProxy.replace('host.docker.internal', '127.0.0.1');
    process.env.HTTPS_PROXY = proxy;
    process.env.HTTP_PROXY = proxy;
    process.env.https_proxy = proxy;
    process.env.http_proxy = proxy;
    process.env.NODE_USE_ENV_PROXY = '1';
  }
  if (ca) {
    // Stable path, overwritten in place — a fresh mkdtemp per boot would leak one
    // tmp dir per process start across --watch reloads / KeepAlive respawns. The
    // gateway CA is a public certificate (not a key); tmpdir() is user-private.
    const dir = join(tmpdir(), 'boondi-crm-onecli');
    mkdirSync(dir, { recursive: true });
    const caPath = join(dir, 'gateway-ca.pem');
    writeFileSync(caPath, ca, { mode: 0o600 });
    process.env.NODE_EXTRA_CA_CERTS = caPath;
  }

  loaded = true;
  log('onecli_creds_loaded', { proxy: Boolean(rawProxy), ca: Boolean(ca) });
}
