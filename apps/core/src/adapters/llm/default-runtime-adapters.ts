import type { AgentExecutionAdapter } from '../../application/agent-execution/agent-execution-adapter.js';
import {
  createAgentExecutionAdapterRegistry,
  type AgentExecutionAdapterRegistry,
} from '../../application/agent-execution/agent-execution-adapter-registry.js';
import type { MemoryLlmClient } from '../../domain/ports/memory-llm-client.js';
import { createAnthropicClaudeAgentExecutionAdapter } from './anthropic-claude-agent/execution-adapter.js';
import { createDeepAgentsLangChainExecutionAdapter } from './deepagents-langchain/execution-adapter.js';
import { createAnthropicMemoryLlmClient } from './anthropic-claude-agent/memory-llm-client.js';
import { createOpenAiMemoryLlmClient } from './openai-memory/openai-memory-llm-client.js';
import { createAnthropicMemoryDirectLlmClient } from './anthropic-memory-direct/anthropic-memory-direct-llm-client.js';
import { createRouteAwareMemoryLlmClient } from './route-aware-memory-llm-client.js';
import type { AgentEngine } from '../../shared/agent-engine.js';
export { createRunnerSandboxProvider as createDefaultRunnerSandboxProvider } from '../sandbox/runner-sandbox-provider.js';

export function createDefaultAgentExecutionAdapter(): AgentExecutionAdapter {
  return createAnthropicClaudeAgentExecutionAdapter();
}

export function createDefaultAgentExecutionAdapterRegistry(): AgentExecutionAdapterRegistry {
  return createAgentExecutionAdapterRegistry([
    createAnthropicClaudeAgentExecutionAdapter(),
    createDeepAgentsLangChainExecutionAdapter(),
  ]);
}

// `getMemoryEngine` is threaded from the composition root (runtime-app) so this
// adapter does not reach into the config layer; the getter (not a snapshot) lets
// a reviewed settings reload change the memory engine without restart.
export function createDefaultMemoryLlmClient(
  getMemoryEngine: () => AgentEngine,
): MemoryLlmClient {
  return createRouteAwareMemoryLlmClient({
    anthropic: createAnthropicMemoryLlmClient(),
    openai: createOpenAiMemoryLlmClient(),
    anthropicDirect: createAnthropicMemoryDirectLlmClient(),
    getEngine: getMemoryEngine,
  });
}
