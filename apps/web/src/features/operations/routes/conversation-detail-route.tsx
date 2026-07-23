import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  Bot,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRoundCheck,
  WifiOff,
} from 'lucide-react';
import { useState } from 'react';

import { useRuntimeConnection } from '../../../lib/api/runtime-connection';
import { PageHeader } from '../../../ui/compositions/page-header';
import { PageState } from '../../../ui/compositions/page-state';
import { Panel } from '../../../ui/compositions/panel';
import { StatusBadge } from '../../../ui/compositions/status-badge';
import { Badge } from '../../../ui/primitives/badge';
import { Button } from '../../../ui/primitives/button';
import { ConversationApproversDialog } from '../components/conversation-approvers-dialog';
import { ConversationInstallDialog } from '../components/conversation-install-dialog';
import type {
  AgentOption,
  ConversationDetail,
  ConversationInstall,
} from '../conversation-api';
import {
  useConversationDashboard,
  useConversationDetail,
} from '../use-conversations';

export function ConversationDetailRoute() {
  const { conversationId } = useParams({
    from: '/conversations/$conversationId',
  });
  const connection = useRuntimeConnection();
  const dashboard = useConversationDashboard();
  const detail = useConversationDetail(conversationId, dashboard.data);

  if (!connection.transport) {
    return (
      <PageState
        description="Start Gantry with local-owner UI linkage to load this conversation."
        icon={<WifiOff size={18} aria-hidden="true" />}
        kind="offline"
        title="Runtime not connected"
      />
    );
  }
  if (dashboard.isPending || detail.isPending) {
    return (
      <PageState
        description="Loading conversation history and administration state."
        icon={
          <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
        }
        kind="loading"
        title="Loading conversation"
      />
    );
  }
  if (dashboard.isError || detail.isError) {
    const error = dashboard.error ?? detail.error;
    return (
      <PageState
        action={
          <Button
            onClick={() => {
              void dashboard.refetch();
              void detail.refetch();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" /> Retry
          </Button>
        }
        description={error?.message ?? 'Conversation could not be loaded.'}
        icon={<TriangleAlert size={18} aria-hidden="true" />}
        kind="error"
        title="Conversation could not be loaded"
      />
    );
  }
  if (!dashboard.data || !detail.data) return null;
  return (
    <ConversationDetailContent
      agents={dashboard.data.agents}
      detail={detail.data}
      installs={dashboard.data.installs}
    />
  );
}

function ConversationDetailContent({
  agents,
  detail,
  installs,
}: {
  agents: AgentOption[];
  detail: ConversationDetail;
  installs: ConversationInstall[];
}) {
  const [installOpen, setInstallOpen] = useState(false);
  const [approversOpen, setApproversOpen] = useState(false);
  const conversation = detail.conversation;
  const install = installs.find(
    (item) =>
      item.conversationId === conversation.id && item.status === 'active',
  );

  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-6">
      <Link
        className="inline-flex min-h-8 w-fit items-center gap-2 text-xs font-semibold text-text-secondary no-underline hover:text-text"
        search={{
          q: '',
          status: 'all',
          page: 1,
          sort: 'updatedAt',
          desc: false,
        }}
        to="/conversations"
      >
        <ArrowLeft size={15} aria-hidden="true" /> Conversations
      </Link>
      <PageHeader
        eyebrow={`${conversation.provider} · ${conversation.kind}`}
        title={conversation.name}
        description="Member count and provider activity metadata are unavailable from the current API."
        action={<StatusBadge status={conversation.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Recent messages"
          description={`${detail.messages.length} canonical messages loaded`}
          action={<MessageSquareText size={16} aria-hidden="true" />}
        >
          <div className="divide-y divide-border">
            {detail.messages.map((message) => (
              <article className="grid gap-2 px-5 py-4" key={message.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-text">
                    {message.author}
                    <Badge>{message.direction}</Badge>
                  </span>
                  <span className="text-xs text-text-muted">
                    {formatDate(message.createdAt)}
                  </span>
                </div>
                <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
                  {message.content}
                </p>
              </article>
            ))}
            {detail.messages.length === 0 ? (
              <p className="m-0 p-5 text-sm text-text-secondary">
                No messages are stored for this conversation.
              </p>
            ) : null}
          </div>
        </Panel>

        <div className="grid content-start gap-4">
          <Panel title="Installed agent" action={<Bot size={16} />}>
            <div className="grid gap-3 p-4">
              <p className="m-0 text-sm font-semibold text-text">
                {conversation.agent}
              </p>
              <p className="m-0 text-xs leading-5 text-text-secondary">
                Handles eligible messages after conversation policy and trigger
                checks.
              </p>
              <Button onClick={() => setInstallOpen(true)}>
                Change installation
              </Button>
            </div>
          </Panel>

          <Panel title="Conversation policy" action={<ShieldCheck size={16} />}>
            <dl className="m-0 grid gap-3 p-4 text-[13px]">
              <Detail
                label="Trigger"
                value={install?.routeConfig?.trigger ?? 'Unavailable'}
              />
              <Detail
                label="Requires trigger"
                value={formatBoolean(install?.routeConfig?.requiresTrigger)}
              />
              <Detail
                label="Memory scope"
                value={install?.memoryScope ?? 'Unavailable'}
              />
            </dl>
          </Panel>
        </div>
      </div>

      <Panel
        title="Threads"
        description={`${detail.threads.length} stored thread records`}
      >
        <div className="flex flex-wrap gap-2 p-4">
          {detail.threads.map((thread) => (
            <Badge key={thread.id}>
              {thread.title ?? thread.id} · {thread.status}
            </Badge>
          ))}
          {detail.threads.length === 0 ? (
            <span className="text-sm text-text-secondary">
              No thread records are stored.
            </span>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Control approvers"
        description="Verified conversation members who can answer permission prompts."
        action={<UserRoundCheck size={16} aria-hidden="true" />}
      >
        <div className="flex flex-wrap gap-2 p-4">
          {detail.approverIds.map((id) => (
            <Badge key={id}>{id}</Badge>
          ))}
          {detail.approverIds.length === 0 ? (
            <span className="text-sm text-text-secondary">
              No control approvers configured.
            </span>
          ) : null}
        </div>
        <div className="border-t border-border p-4">
          <Button onClick={() => setApproversOpen(true)}>
            Manage approvers
          </Button>
        </div>
      </Panel>

      <ConversationInstallDialog
        agents={agents}
        conversation={conversation}
        open={installOpen}
        onOpenChange={setInstallOpen}
      />
      <ConversationApproversDialog
        approverIds={detail.approverIds}
        conversationId={conversation.id}
        conversationName={conversation.name}
        open={approversOpen}
        onOpenChange={setApproversOpen}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 ml-0 text-text">{value}</dd>
    </div>
  );
}

function formatBoolean(value?: boolean): string {
  return value === undefined ? 'Unavailable' : value ? 'Yes' : 'No';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
