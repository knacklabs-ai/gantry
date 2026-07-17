import {
  BrainCircuit,
  Database,
  LoaderCircle,
  MoonStar,
  RefreshCw,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';

import { useRuntimeConnection } from '../../../lib/api/runtime-connection';
import { PageHeader } from '../../../ui/compositions/page-header';
import { PageState } from '../../../ui/compositions/page-state';
import { Panel } from '../../../ui/compositions/panel';
import { StatusBadge } from '../../../ui/compositions/status-badge';
import { Badge } from '../../../ui/primitives/badge';
import { Button } from '../../../ui/primitives/button';
import { useMemoryDashboard, useTriggerMemoryDreaming } from '../use-memory';

export function MemoryEngineRoute() {
  const connection = useRuntimeConnection();
  const query = useMemoryDashboard();
  const dreaming = useTriggerMemoryDreaming();
  const data = query.data;

  return (
    <div className="mx-auto grid w-full max-w-[1080px] gap-6">
      <PageHeader
        eyebrow="Runtime"
        title="Memory engine"
        description="Brain indexes, memory counts, embeddings, and dreaming status."
        action={
          connection.transport ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void query.refetch()}>
                <RefreshCw size={16} aria-hidden="true" /> Refresh
              </Button>
              <Button
                disabled={dreaming.isPending}
                onClick={() => dreaming.mutate()}
              >
                <MoonStar size={16} aria-hidden="true" />
                {dreaming.isPending ? 'Starting...' : 'Run dreaming'}
              </Button>
            </div>
          ) : undefined
        }
      />
      {!connection.transport ? (
        <PageState
          description="Start Gantry with local-owner UI linkage to inspect memory state."
          icon={<WifiOff size={18} aria-hidden="true" />}
          kind="offline"
          title="Runtime not connected"
        />
      ) : query.isPending ? (
        <PageState
          description="Loading count-oriented memory and Brain status."
          icon={
            <LoaderCircle
              className="animate-spin"
              size={18}
              aria-hidden="true"
            />
          }
          kind="loading"
          title="Loading memory engine"
        />
      ) : query.isError ? (
        <PageState
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
          description={query.error.message}
          icon={<TriangleAlert size={18} aria-hidden="true" />}
          kind="error"
          title="Memory status could not be loaded"
        />
      ) : data ? (
        <MemoryEngineContent data={data} />
      ) : null}
      {dreaming.error ? (
        <p
          className="m-0 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger"
          role="alert"
        >
          {dreaming.error.message}
        </p>
      ) : null}
    </div>
  );
}

function MemoryEngineContent({
  data,
}: {
  data: NonNullable<ReturnType<typeof useMemoryDashboard>['data']>;
}) {
  const runningDreams = data.dreamingRuns.filter(
    (run) => run.status === 'running',
  ).length;
  const stages = [
    {
      label: 'Capture',
      detail: `${data.loadedMemoryCount} memory records loaded; ${data.brain.pages} Brain pages indexed.`,
      status: 'ready',
    },
    {
      label: 'Embeddings',
      detail: `${data.brain.readyEmbeddings} ready; ${data.brain.pendingEmbeddings} pending.`,
      status: data.brain.pendingEmbeddings > 0 ? 'attention' : 'ready',
    },
    {
      label: 'Relationships',
      detail: `${data.brain.entities} entities and ${data.brain.edges} edges.`,
      status: 'ready',
    },
    {
      label: 'Dreaming',
      detail: `${runningDreams} running; ${data.brain.dreamDecisions} decisions indexed.`,
      status: runningDreams > 0 ? 'attention' : 'ready',
    },
  ] as const;

  return (
    <>
      <Panel
        title="Pipeline evidence"
        action={<BrainCircuit size={17} aria-hidden="true" />}
      >
        <div className="grid gap-3 p-4 md:grid-cols-4">
          {stages.map((stage, index) => (
            <article
              className="rounded-md border border-border p-4"
              key={stage.label}
            >
              <span className="font-mono text-[10px] text-text-muted">
                0{index + 1}
              </span>
              <div className="mt-3 flex items-center justify-between gap-2">
                <strong className="text-[13px] text-text">{stage.label}</strong>
                <StatusBadge status={stage.status} />
              </div>
              <p className="mt-2 mb-0 text-xs leading-5 text-text-secondary">
                {stage.detail}
              </p>
            </article>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Stores"
          description="Counts only; content remains in What I remember."
          action={<Database size={17} aria-hidden="true" />}
        >
          <div className="divide-y divide-border">
            <Store name="Brain pages" value={data.brain.pages} />
            <Store name="Channel pages" value={data.brain.channelPages} />
            <Store name="Dream pages" value={data.brain.dreamPages} />
            <Store
              name="Loaded memory records"
              value={data.loadedMemoryCount}
            />
          </div>
        </Panel>
        <Panel title="Policy visibility" description="Current API support">
          <div className="grid gap-4 p-4 text-[13px]">
            <Detail label="Review queue" value="Unavailable" />
            <Detail label="Retention policy" value="Unavailable" />
            <Detail
              label="Last dream cursor"
              value={data.brain.lastDreamCursor ?? 'None'}
            />
            <Detail
              label="Harvest conversations"
              value={String(data.brain.harvestEnabledConversations)}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}

function Store({ name, value }: { name: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4">
      <strong className="text-[13px] text-text">{name}</strong>
      <Badge>{value} records</Badge>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border pb-3">
      <span className="block text-xs text-text-muted">{label}</span>
      <strong className="mt-1 block font-medium text-text">{value}</strong>
    </div>
  );
}
