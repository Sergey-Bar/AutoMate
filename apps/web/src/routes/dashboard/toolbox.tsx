import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ExternalLink,
  Search,
  cn,
} from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import {
  CopyButton,
  PageFrame,
  PageHeader,
  PagerControls,
  Quiet,
  Segmented,
  usePager,
} from '../../components/kit.js';
import { KindIcon } from '../../components/responsive.js';
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
 * ## A launcher, not a catalogue
 *
 * Each tool is a tile — the glyph of what it does, its name, and a dot for whether the
 * repository already has it — so a screen of them reads at a glance the way an app grid
 * does. The detail (why it fits, the setup line, the documentation) is one click away in a
 * dialog rather than printed on every card, which is what lets the grid fit any screen.
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

/** A tile is 6.5rem wide at least and 7rem tall, with a 0.75rem gap. */
const TILE_MIN_WIDTH = 104;
const TILE_HEIGHT = 112;
const TILE_GAP = 12;

/**
 * How many tiles fit the grid's box — columns from its width, rows from its height — kept
 * current as it resizes. Without `ResizeObserver` (jsdom) it answers `fallback`.
 */
export function useTileCount(fallback: number): [number, (element: HTMLElement | null) => void] {
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  const [count, setCount] = React.useState(fallback);
  React.useEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const columns = Math.floor((element.clientWidth + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP));
      const rows = Math.floor((element.clientHeight + TILE_GAP) / (TILE_HEIGHT + TILE_GAP));
      setCount(columns > 0 && rows > 0 ? columns * rows : fallback);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, fallback]);
  return [count, setElement];
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
  // The launcher opens on every tool: recommended ones sort first and wear a ring, so the
  // grid reads as a full kit with the next pick at its head rather than one lonely tile.
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [capability, setCapability] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [selected, select] = React.useState<ToolboxEntry | null>(null);
  const [size, gridRef] = useTileCount(24);
  const needle = query.trim().toLowerCase();
  const visible = sortToolbox(entries).filter(
    (entry) =>
      (status === 'all' || entry.status === status) &&
      (capability === 'all' || entry.capability === capability) &&
      (needle.length === 0 ||
        entry.name.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)),
  );
  const pager = usePager(visible, size);
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
      <div className="flex shrink-0 items-center gap-2">
        <label className="relative block min-w-0 flex-1">
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
          <span className="hidden sm:inline">Capability</span>
          <select
            data-testid="toolbox-capability"
            aria-label="Capability"
            value={capability}
            onChange={(event) => setCapability(event.target.value)}
            className="min-h-11 max-w-40 rounded-lg border border-border bg-surface-raised px-3 text-sm text-fg sm:max-w-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
      <div aria-hidden="true" className="flex shrink-0 items-center gap-4 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" />
          Recommended
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success" />
          In use
        </span>
        <span className="hidden sm:inline">Open a tool for setup and docs</span>
      </div>
      <div ref={gridRef} className="min-h-0 flex-1 overflow-hidden">
        {pager.items.length === 0 ? (
          <Quiet data-testid="toolbox-empty">
            {status === 'recommended'
              ? 'Nothing to recommend: every capability this stack can use is covered.'
              : 'No tool matches.'}
          </Quiet>
        ) : (
          <ul
            aria-label="Tools"
            className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] content-start gap-3"
          >
            {pager.items.map((entry) => (
              <ToolTile key={entry.id} entry={entry} onOpen={() => select(entry)} />
            ))}
          </ul>
        )}
      </div>
      <PagerControls pager={pager} label="tool" />
      <ToolDialog entry={selected} onClose={() => select(null)} />
    </PageFrame>
  );
}

const STATUS_DOT = {
  recommended: 'bg-warning',
  'in-use': 'bg-success',
  available: null,
} as const;

const STATUS_WORD = {
  recommended: 'recommended',
  'in-use': 'in use',
  available: 'available',
} as const;

function ToolTile({
  entry,
  onOpen,
}: {
  entry: ToolboxEntry;
  onOpen: () => void;
}): React.ReactElement {
  const dot = STATUS_DOT[entry.status];
  return (
    <li data-testid={`toolbox-${entry.id}`} className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        title={`${entry.name} — ${CAPABILITY_LABELS[entry.capability]}`}
        className="group flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <span
          className={cn(
            'relative flex h-14 w-14 items-center justify-center rounded-2xl border bg-surface-raised text-fg transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0',
            entry.status === 'recommended' ? 'border-warning' : 'border-border',
          )}
        >
          <KindIcon kind={entry.capability} size={24} />
          {dot === null ? null : (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-surface',
                dot,
              )}
            />
          )}
        </span>
        <span className="block w-full truncate text-sm">{entry.name}</span>
        <span className="sr-only">, {STATUS_WORD[entry.status]}</span>
      </button>
    </li>
  );
}

const STATUS_BADGE = {
  recommended: 'warning',
  'in-use': 'success',
  available: 'outline',
} as const;

function ToolDialog({
  entry,
  onClose,
}: {
  entry: ToolboxEntry | null;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      data-testid="toolbox-dialog"
    >
      {entry === null ? null : (
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface-muted">
                <KindIcon kind={entry.capability} size={22} />
              </span>
              <div className="min-w-0">
                <DialogTitle>{entry.name}</DialogTitle>
                <div className="text-xs uppercase tracking-widest text-fg-muted">
                  {CAPABILITY_LABELS[entry.capability]} · {entry.priority} priority
                </div>
              </div>
              <Badge variant={STATUS_BADGE[entry.status]} className="ml-auto shrink-0">
                {STATUS_WORD[entry.status]}
              </Badge>
            </div>
            <DialogDescription>{entry.description}</DialogDescription>
          </DialogHeader>
          <p className="mt-3 max-w-measure text-sm text-fg-muted">{entry.reason}</p>
          <div className="mt-4 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-surface-muted px-2 py-1.5 font-mono text-xs">
              {entry.setup}
            </code>
            <CopyButton text={entry.setup} label={`${entry.name} setup`} />
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
        </DialogContent>
      )}
    </Dialog>
  );
}
