import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  requireRuntimeTransport,
  useRuntimeConnection,
} from '../../lib/api/runtime-connection';
import {
  loadMemories,
  loadMemoryDashboard,
  memoryQueryKeys,
  triggerMemoryDreaming,
} from './memory-api';

export function useMemoryDashboard() {
  const connection = useRuntimeConnection();
  return useQuery({
    queryKey: memoryQueryKeys.dashboard(),
    enabled: Boolean(connection.transport),
    queryFn: () => loadMemoryDashboard(requireRuntimeTransport(connection)),
  });
}

export function useMemories(query: string) {
  const connection = useRuntimeConnection();
  return useQuery({
    queryKey: memoryQueryKeys.list(query.trim()),
    enabled: Boolean(connection.transport),
    queryFn: () => loadMemories(requireRuntimeTransport(connection), query),
  });
}

export function useTriggerMemoryDreaming() {
  const connection = useRuntimeConnection();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      triggerMemoryDreaming(requireRuntimeTransport(connection)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: memoryQueryKeys.all });
    },
  });
}
