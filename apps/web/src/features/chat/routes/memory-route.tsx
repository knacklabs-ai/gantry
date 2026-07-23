import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldQuestion,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { type FormEvent } from 'react';

import { useRuntimeConnection } from '../../../lib/api/runtime-connection';
import { PageHeader } from '../../../ui/compositions/page-header';
import { PageState } from '../../../ui/compositions/page-state';
import { Panel } from '../../../ui/compositions/panel';
import { TextField } from '../../../ui/compositions/text-field';
import { Badge } from '../../../ui/primitives/badge';
import { Button } from '../../../ui/primitives/button';
import type { MemoryItem } from '../../runtime/memory-api';
import { useMemories } from '../../runtime/use-memory';

const kinds = [
  'all',
  'preference',
  'decision',
  'fact',
  'correction',
  'constraint',
  'reference',
  'procedure',
] as const;
const confidences = ['all', 'high', 'medium', 'low'] as const;

export function MemoryRoute() {
  const search = useSearch({ from: '/memory' });
  const navigate = useNavigate({ from: '/memory' });
  const connection = useRuntimeConnection();
  const query = useMemories(search.q);
  const visible = (query.data ?? []).filter(
    (memory) =>
      (search.kind === 'all' || memory.kind === search.kind) &&
      (search.confidence === 'all' ||
        confidenceLabel(memory.confidence) === search.confidence),
  );

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void navigate({
      search: { ...search, q: String(form.get('q') ?? '') },
    });
  }

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-6">
      <PageHeader
        eyebrow="Continuity"
        title="What I remember"
        description="Runtime memory values with confidence, scope, and provenance."
        action={
          connection.transport ? (
            <Button variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </Button>
          ) : undefined
        }
      />
      {!connection.transport ? (
        <PageState
          description="Start Gantry with local-owner UI linkage to load remembered information."
          icon={<WifiOff size={18} aria-hidden="true" />}
          kind="offline"
          title="Runtime not connected"
        />
      ) : (
        <>
          <form
            className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={submitSearch}
          >
            <TextField
              defaultValue={search.q}
              id="memory-search"
              label="Search memory"
              name="q"
              placeholder="Search remembered values"
            />
            <Button type="submit">
              <Search size={15} aria-hidden="true" /> Search
            </Button>
          </form>
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterSelect
              label="Kind"
              options={kinds}
              value={search.kind}
              onChange={(kind) =>
                void navigate({ search: { ...search, kind } })
              }
            />
            <FilterSelect
              label="Confidence"
              options={confidences}
              value={search.confidence}
              onChange={(confidence) =>
                void navigate({ search: { ...search, confidence } })
              }
            />
          </div>
          {query.isPending ? (
            <PageState
              description="Loading remembered information."
              icon={
                <LoaderCircle
                  className="animate-spin"
                  size={18}
                  aria-hidden="true"
                />
              }
              kind="loading"
              title="Loading memory"
            />
          ) : query.isError ? (
            <PageState
              action={
                <Button onClick={() => void query.refetch()}>Retry</Button>
              }
              description={query.error.message}
              icon={<TriangleAlert size={18} aria-hidden="true" />}
              kind="error"
              title="Memory could not be loaded"
            />
          ) : (
            <MemoryList items={visible} total={query.data?.length ?? 0} />
          )}
        </>
      )}
    </div>
  );
}

function MemoryList({ items, total }: { items: MemoryItem[]; total: number }) {
  return (
    <Panel
      title="Remembered information"
      description={`${items.length} of ${total} loaded records shown`}
      action={<ShieldQuestion size={17} aria-hidden="true" />}
    >
      <div className="divide-y divide-border">
        {items.map((memory) => (
          <article className="px-5 py-5" key={memory.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{memory.kind}</Badge>
              <Badge tone={confidenceTone(memory.confidence)}>
                {confidenceLabel(memory.confidence)} confidence
              </Badge>
              {memory.isPinned ? <Badge tone="attention">Pinned</Badge> : null}
            </div>
            <h2 className="mt-3 mb-0 font-mono text-xs font-semibold text-text">
              {memory.key}
            </h2>
            <p className="mt-2 mb-0 text-sm leading-6 text-text">
              {memory.value}
            </p>
            {memory.why ? (
              <p className="mt-2 mb-0 text-xs leading-5 text-text-secondary">
                {memory.why}
              </p>
            ) : null}
            <p className="mt-3 mb-0 inline-flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <History size={14} aria-hidden="true" />
              {memory.source} · {memory.subjectType}:{memory.subjectId} ·
              Updated {formatDate(memory.updatedAt)}
            </p>
          </article>
        ))}
        {items.length === 0 ? (
          <p className="m-0 p-5 text-sm text-text-secondary">
            No memory records match these filters.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function FilterSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-text">
      {label}
      <select
        className="h-9 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-normal text-text capitalize"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === 'all' ? `All ${label.toLowerCase()}s` : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function confidenceLabel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

function confidenceTone(confidence: number) {
  const label = confidenceLabel(confidence);
  return label === 'high'
    ? ('success' as const)
    : label === 'medium'
      ? ('attention' as const)
      : ('danger' as const);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
