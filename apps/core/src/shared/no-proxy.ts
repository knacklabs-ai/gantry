const AGENT_EGRESS_NO_PROXY_HOSTS = [
  '127.0.0.1',
  'localhost',
  '::1',
  'github.com',
  '.github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
] as const;

function splitNoProxy(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeNoProxyHosts(
  values: readonly (string | undefined)[],
  defaults: readonly string[],
): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const userHosts = values.flatMap((value) => splitNoProxy(value));
  for (const host of [...userHosts, ...defaults]) {
    const key = host.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(host);
  }
  return out.join(',');
}

export function mergeAgentEgressNoProxy(
  ...values: readonly (string | undefined)[]
): string {
  return mergeNoProxyHosts(values, AGENT_EGRESS_NO_PROXY_HOSTS);
}

export function applyAgentEgressNoProxyEnv(
  env: Record<string, string | undefined>,
): void {
  const merged = mergeAgentEgressNoProxy(env.NO_PROXY, env.no_proxy);
  env.NO_PROXY = merged;
  env.no_proxy = merged;
}
