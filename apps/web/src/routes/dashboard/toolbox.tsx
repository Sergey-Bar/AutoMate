import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, ExternalLink, Search, cn } from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import {
  PageFrame,
  PageHeader,
  PagerControls,
  Quiet,
  Segmented,
  usePager,
} from '../../components/kit.js';
import { ProjectGate } from '../../components/ProjectGate.js';
import { useResource } from '../../hooks/useResource.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import type { RegisteredProject, RepoScan, ToolboxEntry } from '../../lib/qa.js';
import { CAPABILITY_LABELS } from './health.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/toolbox',
  component: () => <ToolboxPage qa={createQaClient()} />,
});

/**
 * The toolbox: every QA tool the product knows, against what this repository already has.
 *
 * ## A recommendation has picked
 *
 * One tool is recommended per missing capability — the scan's own decision, made against
 * the repository's ecosystems — and the alternatives are listed as `available`. Three
 * load-testing tools all marked "recommended" would say "pick one" without saying which.
 *
 * ## The product never installs anything
 *
 * `setup` is shown as text to copy. Adding a dependency to someone's repository is a change
 * they review in a pull request, not a button on a dashboard.
 */
const STATUS_FILTERS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'in-use', label: 'In use' },
  { value: 'all', label: 'All' },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const STATUS_ORDER = { recommended: 0, 'in-use': 1, available: 2 } as const;

export function sortToolbox(entries: readonly ToolboxEntry[]): ToolboxEntry[] {
  return entries
    .slice()
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
        left.name.localeCompare(right.name),
    );
}

export function ToolboxPage({ qa }: { qa: QaClient }): React.ReactElement {
  return (
    <ProjectGate qa={qa} title="Toolbox">
      {(project, switcher) => <ToolboxBody qa={qa} project={project} switcher={switcher} />}
    </ProjectGate>
  );
}

function ToolboxBody({
  qa,
  project,
  switcher,
}: {
  qa: QaClient;
  project: RegisteredProject;
  switcher: React.ReactNode;
}): React.ReactElement {
  const scan = useResource<RepoScan>(() => qa.getScan(project.id), [qa, project.id]);
  if (scan.status !== 'ready') {
    return (
      <PageFrame data-testid="toolbox-page">
        <PageHeader title="Toolbox" subtitle={project.name} />
        {scan.status === 'error' ? (
          <Quiet role="alert" data-testid="toolbox-error">
            The repository could not be scanned: {scan.message}
          </Quiet>
        ) : (
          <Quiet data-testid="toolbox-loading">Scanning {project.name}…</Quiet>
        )}
      </PageFrame>
    );
  }
  return <ToolboxCatalogue project={project} entries={scan.value.toolbox} switcher={switcher} />;
}

function ToolboxCatalogue({
  project,
  entries,
  switcher,
}: {
  project: RegisteredProject;
  entries: ToolboxEntry[];
  switcher: React.ReactNode;
}): React.ReactElement {
  const recommended = entries.filter((entry) => entry.status === 'recommended').length;
  const inUse = entries.filter((entry) => entry.status === 'in-use').length;
  const [status, setStatus] = React.useState<StatusFilter>(recommended > 0 ? 'recommended' : 'all');
  const [capability, setCapability] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const needle = query.trim().toLowerCase();
  const visible = sortToolbox(entries).filter(
    (entry) =>
      (status === 'all' || entry.status === status) &&
      (capability === 'all' || entry.capability === capability) &&
      (needle.length === 0 ||
        entry.name.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)),
  );
  const pager = usePager(visible, 6);
  const capabilities = [...new Set(entries.map((entry) => entry.capability))];
  return (
    <PageFrame data-testid="toolbox-page">
      <PageHeader
        title="Toolbox"
        subtitle={`${String(recommended)} recommended for ${project.name} · ${String(inUse)} already in use · ${String(entries.length)} that fit its stack`}
        actions={
          <>
            {switcher}
            <Segmented label="Show" options={STATUS_FILTERS} value={status} onChange={setStatus} />
          </>
        }
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="relative block min-w-64 flex-1">
          <span className="sr-only">Search the toolbox</span>
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="search"
            data-testid="toolbox-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools"
            className="min-h-11 w-full rounded-lg border border-border bg-surface-raised pl-9 pr-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Capability
          <select
            data-testid="toolbox-capability"
            value={capability}
            onChange={(event) => setCapability(event.target.value)}
            className="min-h-11 rounded-lg border border-border bg-surface-raised px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <option value="all">All capabilities</option>
            {capabilities.map((entry) => (
              <option key={entry} value={entry}>
                {CAPABILITY_LABELS[entry]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pager.items.length === 0 ? (
        <Quiet data-testid="toolbox-empty">
          {status === 'recommended'
            ? 'Nothing to recommend: every capability this stack can use is covered.'
            : 'No tool matches.'}
        </Quiet>
      ) : (
        <ul className="grid content-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pager.items.map((entry) => (
            <ToolCard key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      <PagerControls pager={pager} label="tool" />
    </PageFrame>
  );
}

const STATUS_BADGE = {
  recommended: 'warning',
  'in-use': 'success',
  available: 'outline',
} as const;

function ToolCard({ entry }: { entry: ToolboxEntry }): React.ReactElement {
  return (
    <li
      data-testid={`toolbox-${entry.id}`}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl border bg-surface-raised p-4',
        entry.status === 'recommended' ? 'border-warning' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate text-lg font-light">{entry.name}</span>
          <div className="text-xs uppercase tracking-widest text-fg-muted">
            {CAPABILITY_LABELS[entry.capability]} · {entry.priority} priority
          </div>
        </div>
        <Badge variant={STATUS_BADGE[entry.status]} className="shrink-0">
          {entry.status.replace('-', ' ')}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 max-w-measure text-sm text-fg-muted">{entry.description}</p>
      <p className="mt-1 truncate text-xs text-fg-muted" title={entry.reason}>
        {entry.reason}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-3">
        <code
          className="min-w-0 flex-1 truncate rounded-md bg-surface-muted px-2 py-1.5 text-xs"
          title={entry.setup}
        >
          {entry.setup}
        </code>
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${entry.name} documentation (opens in a new tab)`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}
