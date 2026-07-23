import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  requireRuntimeTransport,
  useRuntimeConnection,
} from '../../lib/api/runtime-connection';
import {
  conversationQueryKeys,
  discoverConversations,
  loadConversationDashboard,
  loadConversationDetail,
  replaceConversationApprovers,
  replaceConversationInstall,
  type ConversationDashboard,
  type ConversationView,
} from './conversation-api';

export function useConversationDashboard() {
  const connection = useRuntimeConnection();
  return useQuery({
    queryKey: conversationQueryKeys.dashboard(),
    enabled: Boolean(connection.transport),
    queryFn: () =>
      loadConversationDashboard(requireRuntimeTransport(connection)),
  });
}

export function useConversationDetail(
  conversationId: string,
  dashboard?: ConversationDashboard,
) {
  const connection = useRuntimeConnection();
  return useQuery({
    queryKey: conversationQueryKeys.detail(conversationId),
    enabled: Boolean(connection.transport && dashboard),
    queryFn: () =>
      loadConversationDetail(
        requireRuntimeTransport(connection),
        conversationId,
        dashboard as ConversationDashboard,
      ),
  });
}

export function useDiscoverConversations() {
  const connection = useRuntimeConnection();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerAccountId: string) =>
      discoverConversations(
        requireRuntimeTransport(connection),
        providerAccountId,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: conversationQueryKeys.all,
      });
    },
  });
}

export function useReplaceConversationApprovers() {
  const connection = useRuntimeConnection();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; userIds: string[] }) =>
      replaceConversationApprovers(
        requireRuntimeTransport(connection),
        input.conversationId,
        input.userIds,
      ),
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({
        queryKey: conversationQueryKeys.detail(input.conversationId),
      });
    },
  });
}

export function useReplaceConversationInstall() {
  const connection = useRuntimeConnection();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      conversation: ConversationView;
      currentAgentId?: string;
      nextAgentId?: string;
      trigger?: string;
      requiresTrigger?: boolean;
      approverUserIds?: string[];
    }) =>
      replaceConversationInstall(requireRuntimeTransport(connection), input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: conversationQueryKeys.all,
      });
    },
  });
}
