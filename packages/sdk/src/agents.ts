type TransportLike = {
  request<T>(options: {
    method: string;
    path: string;
    body?: unknown;
  }): Promise<T>;
};

export type AgentAdminBoundConversation = {
  conversationId: string;
  provider: string;
  kind: string;
  displayName?: string;
  senderPolicy?: {
    allow: '*' | string[];
    mode: 'trigger' | 'drop';
  };
  requiresTrigger?: boolean;
  approverUserIds: string[];
};

export type AgentAdminResponse = {
  agent: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  boundConversations: AgentAdminBoundConversation[];
};

export function createAgentAdminClient(transport: TransportLike) {
  return {
    getAdmin: (agentId: string) =>
      transport.request<AgentAdminResponse>({
        method: 'GET',
        path: `/v1/agents/${encodeURIComponent(agentId)}/admin`,
      }),
  };
}
