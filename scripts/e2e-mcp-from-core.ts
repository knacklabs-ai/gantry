// End-to-end proof for the MCP↔core credential decoupling.
//
// Run:  node --env-file=$HOME/gantry/.env --import tsx scripts/e2e-mcp-from-core.ts
//
// It exercises the REAL core code paths that changed (credential resolution +
// materialization) against an EMPTY secret store, then makes REAL MCP tool
// calls to both live connectors (:8081 shopify-api, :8082 boondi-crm) using the
// caller-identity signed with the secret core resolved from runtime .env.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { resolveMcpCredentialEnvForAgent } from '../apps/core/src/application/capability-secrets/mcp-secret-projection.js';
import { materializeMcpRecord } from '../apps/core/src/application/mcp/mcp-server-materialization.js';
import { runtimeEnvValueDynamic } from '../apps/core/src/config/env/index.js';
import { computeIdentitySignature } from '../packages/mcp-crm/src/identity/identity-header.js';

const SIGNING_REF = 'MCP_IDENTITY_SECRET';
const CONNECTORS = [
  { id: 'mcp:shopify-api', name: 'shopify-api', url: 'http://127.0.0.1:8081/mcp' },
  { id: 'mcp:boondi-crm', name: 'boondi-crm', url: 'http://127.0.0.1:8082/mcp' },
];

// A MaterializedMcpServer shaped exactly like settings.yaml after C5: http,
// caller-identity required, NO credential_refs.
function record(c: { id: string; name: string; url: string }) {
  return {
    definition: { id: c.id, name: c.name },
    version: {
      config: {
        transport: 'http',
        url: c.url,
        callerIdentity: {
          mode: 'required',
          headerName: 'x-caller-identity',
          signingRef: SIGNING_REF,
          source: { kind: 'conversation_jid_phone', jidPrefix: 'wa:' },
        },
      },
      credentialRefs: [],
      allowedToolPatterns: ['*'],
      autoApproveToolPatterns: [],
    },
    binding: { required: true },
  } as never;
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main() {
  let failures = 0;
  const fault = (m: string) => {
    console.error(`  ✗ ${m}`);
    failures += 1;
  };

  // An EMPTY secret store — the whole point: core must need nothing here.
  const emptyStore = {
    getSecret: async () => {
      throw new Error('secret store must NOT be consulted for http connectors');
    },
  } as never;

  console.log('\n[1] core resolves credentials with an EMPTY secret store');
  const credentialEnv = await resolveMcpCredentialEnvForAgent({
    appId: 'default' as never,
    agentId: 'boondi_support' as never,
    mcpServers: {
      listMaterializedServersForAgent: async () => CONNECTORS.map(record),
    } as never,
    secrets: emptyStore,
    readRuntimeEnv: runtimeEnvValueDynamic,
    logger: { error: (d, m) => console.error('    [resolve.error]', m, d) },
  });
  const secret = credentialEnv[SIGNING_REF];
  if (!secret) fail(`${SIGNING_REF} not resolved from runtime .env`);
  ok(`signing secret resolved from runtime .env (len=${secret.length}), store untouched`);

  console.log('\n[2] core materializes both connectors (no missing-secret throw)');
  for (const c of CONNECTORS) {
    const cap = materializeMcpRecord(record(c), credentialEnv) as {
      config: { type: string; url?: string };
    };
    if (cap.config.type !== 'http' || cap.config.url !== c.url) {
      fault(`${c.name}: unexpected materialized config ${JSON.stringify(cap.config)}`);
    } else {
      ok(`${c.name} → ${cap.config.url}`);
    }
  }

  // Build the signed X-Caller-Identity header exactly as core does.
  const phone = '+919654405340';
  const ts = Math.floor(Date.now() / 1000);
  const sig = computeIdentitySignature({ phone, ts }, secret);
  const identityHeader = `phone:${phone};ts:${ts};sig:${sig}`;

  console.log('\n[3] REAL MCP calls to both live connectors (signed identity)');
  for (const c of CONNECTORS) {
    console.log(`  - ${c.name} @ ${c.url}`);
    const transport = new StreamableHTTPClientTransport(new URL(c.url), {
      requestInit: { headers: { 'x-caller-identity': identityHeader } },
    });
    const client = new Client(
      { name: 'e2e-from-core', version: '1.0.0' },
      { capabilities: {} },
    );
    try {
      await client.connect(transport); // initialize — identity verified here
      ok(`${c.name}: connected (identity accepted)`);
      const { tools } = await client.listTools();
      ok(`${c.name}: listTools → ${tools.length} tools (${tools.slice(0, 3).map((t) => t.name).join(', ')}…)`);

      // Call a read-only tool to prove a real tool invocation reaches the server.
      const readTool = tools.find((t) => /^(get_|lookup_|list_|check_|search_)/.test(t.name));
      if (!readTool) {
        ok(`${c.name}: no read tool to call; listTools is sufficient proof`);
      } else {
        const args = /phone/i.test(JSON.stringify(readTool.inputSchema ?? {}))
          ? { phone: phone.replace('+', '') }
          : {};
        const res = (await client.callTool({ name: readTool.name, arguments: args })) as {
          isError?: boolean;
        };
        ok(`${c.name}: callTool ${readTool.name} → responded (isError=${res.isError === true})`);
      }
    } catch (err) {
      fault(`${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`E2E FAILED: ${failures} problem(s)`);
    process.exit(1);
  }
  console.log('E2E PASSED: core resolved creds from .env (empty store) and called both MCPs.');
}

main().catch((err) => {
  console.error('E2E ERROR:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
