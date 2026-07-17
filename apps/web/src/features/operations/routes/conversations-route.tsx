import type { ColumnDef } from '@tanstack/react-table';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  LoaderCircle,
  MessagesSquare,
  RefreshCw,
  Search,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';

import { useRuntimeConnection } from '../../../lib/api/runtime-connection';
import { DataTable } from '../../../ui/compositions/data-table';
import { PageHeader } from '../../../ui/compositions/page-header';
import { PageState } from '../../../ui/compositions/page-state';
import { Panel } from '../../../ui/compositions/panel';
import { StatusBadge } from '../../../ui/compositions/status-badge';
import { TextField } from '../../../ui/compositions/text-field';
import { Button } from '../../../ui/primitives/button';
import type { ConversationView } from '../conversation-api';
import {
  useConversationDashboard,
  useDiscoverConversations,
} from '../use-conversations';

export function ConversationsRoute() {
  const search = useSearch({ from: '/conversations' });
  const navigate = useNavigate({ from: '/conversations' });
  const connection = useRuntimeConnection();
  const query = useConversationDashboard();
  const discovery = useDiscoverConversations();
  const [accountId, setAccountId] = useState('');
  const needle = search.q.trim().toLowerCase();
  const visible = (query.data?.conversations ?? []).filter(
    (conversation) =>
      (search.status === 'all' || conversation.status === search.status) &&
      (!needle ||
        `${conversation.name} ${conversation.provider} ${conversation.agent}`
          .toLowerCase()
          .includes(needle)),
  );
  const columns = useConversationColumns();

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void navigate({
      search: { ...search, q: String(form.get('q') ?? ''), page: 1 },
    });
  }

  return (
    <div className="mx-auto grid w-full max-w-[1240px] gap-6">
      <PageHeader
        eyebrow="Operations"
        title="Conversations"
        description="Discovered channels, groups, and direct conversations available to Gantry."
        action={
          connection.transport ? (
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={16} aria-hidden="true" /> Reload
            </Button>
          ) : undefined
        }
      />

      {!connection.transport ? (
        <PageState
          description="Start Gantry with local-owner UI linkage to load conversations."
          icon={<WifiOff size={18} aria-hidden="true" />}
          kind="offline"
          title="Runtime not connected"
        />
      ) : query.isPending ? (
        <PageState
          description="Loading provider accounts, conversations, agents, and installations."
          icon={
            <LoaderCircle
              className="animate-spin"
              size={18}
              aria-hidden="true"
            />
          }
          kind="loading"
          title="Loading conversations"
        />
      ) : query.isError ? (
        <PageState
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
          description={query.error.message}
          icon={<TriangleAlert size={18} aria-hidden="true" />}
          kind="error"
          title="Conversations could not be loaded"
        />
      ) : query.data ? (
        <>
          <Panel
            title="Provider discovery"
            description="Ask one configured provider account to discover conversations now."
          >
            <div className="grid items-end gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="grid gap-1.5 text-xs font-semibold text-text">
                Provider account
                <select
                  className="h-9 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-normal text-text"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="">Select an account</option>
                  {query.data.providerAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label} · {account.status}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!accountId || discovery.isPending}
                onClick={() => discovery.mutate(accountId)}
              >
                <Search size={15} aria-hidden="true" />
                {discovery.isPending ? 'Discovering' : 'Discover'}
              </Button>
            </div>
            {discovery.isError ? (
              <p className="m-0 border-t border-border px-4 py-3 text-xs text-status-danger">
                {discovery.error.message}
              </p>
            ) : null}
          </Panel>

          <form
            className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_190px_auto]"
            onSubmit={submitSearch}
          >
            <TextField
              defaultValue={search.q}
              id="conversation-search"
              label="Search conversations"
              name="q"
              placeholder="Name, provider, or agent"
            />
            <label className="grid gap-1.5 text-xs font-semibold text-text">
              Status
              <select
                className="h-9 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-normal text-text"
                value={search.status}
                onChange={(event) =>
                  void navigate({
                    search: {
                      ...search,
                      status: event.target.value as typeof search.status,
                      page: 1,
                    },
                  })
                }
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <Button variant="secondary" type="submit">
              Search
            </Button>
          </form>

          <Panel
            title="Conversation directory"
            description={`${visible.length} of ${query.data.conversations.length} conversations shown`}
            action={<MessagesSquare size={16} aria-hidden="true" />}
          >
            <DataTable
              columns={columns}
              data={visible}
              emptyMessage="No conversations match these filters."
              page={search.page}
              sort={search.sort}
              descending={search.desc}
              onPageChange={(page) =>
                void navigate({ search: { ...search, page } })
              }
              onSortChange={(sort, desc) =>
                void navigate({
                  search: {
                    ...search,
                    sort: sort as typeof search.sort,
                    desc,
                    page: 1,
                  },
                })
              }
            />
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function useConversationColumns(): ColumnDef<ConversationView>[] {
  return useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Conversation',
        cell: ({ row }) => (
          <Link
            className="font-semibold text-text no-underline hover:underline"
            params={{ conversationId: row.original.id }}
            to="/conversations/$conversationId"
          >
            {row.original.name}
          </Link>
        ),
      },
      { accessorKey: 'provider', header: 'Provider' },
      { accessorKey: 'agent', header: 'Installed agent' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: ({ getValue }) => formatDate(String(getValue())),
      },
    ],
    [],
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
