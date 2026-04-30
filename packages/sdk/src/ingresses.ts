import type { RequestOptions } from './types.js';

type TransportLike = {
  request<T>(options: RequestOptions): Promise<T>;
};

export function createIngressesClient(transport: TransportLike) {
  return {
    create: (input: { name: string; enabled?: boolean; metadata?: unknown }) =>
      transport.request<Record<string, unknown>>({
        method: 'POST',
        path: '/v1/ingresses',
        body: input,
      }),
    list: () =>
      transport.request<{ ingresses: unknown[] }>({
        method: 'GET',
        path: '/v1/ingresses',
      }),
    get: (ingressId: string) =>
      transport.request<Record<string, unknown>>({
        method: 'GET',
        path: `/v1/ingresses/${encodeURIComponent(ingressId)}`,
      }),
    update: (
      ingressId: string,
      patch: { name?: string; enabled?: boolean; metadata?: unknown },
    ) =>
      transport.request<Record<string, unknown>>({
        method: 'PATCH',
        path: `/v1/ingresses/${encodeURIComponent(ingressId)}`,
        body: patch,
      }),
    delete: (ingressId: string) =>
      transport.request<{ deleted: true }>({
        method: 'DELETE',
        path: `/v1/ingresses/${encodeURIComponent(ingressId)}`,
      }),
    rotate: (ingressId: string) =>
      transport.request<Record<string, unknown>>({
        method: 'POST',
        path: `/v1/ingresses/${encodeURIComponent(ingressId)}/rotate`,
      }),
  };
}
