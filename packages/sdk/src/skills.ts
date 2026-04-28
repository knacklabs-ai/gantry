type SkillTransport = {
  request<T>(options: {
    method: string;
    path: string;
    body?: unknown;
  }): Promise<T>;
};

type SkillAssetInput = {
  path: string;
  contentType?: string;
  contentBase64: string;
};

type CreateSkillInput = {
  appId?: string;
  name: string;
  description?: string;
  source?: 'bundled' | 'admin_uploaded' | 'marketplace' | 'system';
};

type UpdateSkillInput = {
  appId?: string;
  name?: string;
  description?: string | null;
  status?: 'active' | 'disabled' | 'deprecated';
};

type CreateSkillVersionInput = {
  appId?: string;
  version?: string;
  entrypoint?: string;
  manifestJson?: string;
  createdBy?: string;
  assets: SkillAssetInput[];
};

export function createAgentSkillsClient(transport: SkillTransport) {
  return {
    list: (agentId: string, input: { appId?: string } = {}) => {
      const params = new URLSearchParams();
      if (input.appId) params.set('appId', input.appId);
      return transport.request<{ skills: unknown[] }>({
        method: 'GET',
        path: `/v1/agents/${encodeURIComponent(agentId)}/skills${params.toString() ? `?${params}` : ''}`,
      });
    },
    enable: (
      agentId: string,
      skillId: string,
      input: { appId?: string; skillVersionId?: string } = {},
    ) =>
      transport.request<Record<string, unknown>>({
        method: 'PUT',
        path: `/v1/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}`,
        body: input,
      }),
    disable: (
      agentId: string,
      skillId: string,
      input: { appId?: string } = {},
    ) => {
      const params = new URLSearchParams();
      if (input.appId) params.set('appId', input.appId);
      return transport.request<{ disabled: boolean; binding?: unknown }>({
        method: 'DELETE',
        path: `/v1/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}${params.toString() ? `?${params}` : ''}`,
      });
    },
  };
}

export function createSkillsClient(transport: SkillTransport) {
  return {
    list: (input: { appId?: string } = {}) => {
      const params = new URLSearchParams();
      if (input.appId) params.set('appId', input.appId);
      return transport.request<{ skills: unknown[] }>({
        method: 'GET',
        path: `/v1/skills${params.toString() ? `?${params}` : ''}`,
      });
    },
    create: (input: CreateSkillInput) =>
      transport.request<Record<string, unknown>>({
        method: 'POST',
        path: '/v1/skills',
        body: input,
      }),
    get: (skillId: string, input: { appId?: string } = {}) => {
      const params = new URLSearchParams();
      if (input.appId) params.set('appId', input.appId);
      return transport.request<Record<string, unknown>>({
        method: 'GET',
        path: `/v1/skills/${encodeURIComponent(skillId)}${params.toString() ? `?${params}` : ''}`,
      });
    },
    update: (skillId: string, patch: UpdateSkillInput) =>
      transport.request<Record<string, unknown>>({
        method: 'PATCH',
        path: `/v1/skills/${encodeURIComponent(skillId)}`,
        body: patch,
      }),
    versions: {
      create: (skillId: string, input: CreateSkillVersionInput) =>
        transport.request<Record<string, unknown>>({
          method: 'POST',
          path: `/v1/skills/${encodeURIComponent(skillId)}/versions`,
          body: input,
        }),
      list: (skillId: string, input: { appId?: string } = {}) => {
        const params = new URLSearchParams();
        if (input.appId) params.set('appId', input.appId);
        return transport.request<{ versions: unknown[] }>({
          method: 'GET',
          path: `/v1/skills/${encodeURIComponent(skillId)}/versions${params.toString() ? `?${params}` : ''}`,
        });
      },
      approve: (
        skillId: string,
        versionId: string,
        input: { appId?: string } = {},
      ) =>
        transport.request<Record<string, unknown>>({
          method: 'POST',
          path: `/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/approve`,
          body: input,
        }),
      reject: (
        skillId: string,
        versionId: string,
        input: { appId?: string } = {},
      ) =>
        transport.request<Record<string, unknown>>({
          method: 'POST',
          path: `/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/reject`,
          body: input,
        }),
    },
  };
}
