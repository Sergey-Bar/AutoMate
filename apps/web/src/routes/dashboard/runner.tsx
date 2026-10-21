import React from 'react';
import { createRoute, Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  cn,
} from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import {
  CopyButton,
  PageFrame,
  PageHeader,
  Panel,
  PagerControls,
  Quiet,
  useFitCount,
  usePager,
} from '../../components/kit.js';
import { KindIcon, Responsive } from '../../components/responsive.js';
import { ProjectGate } from '../../components/ProjectGate.js';
import { useResource } from '../../hooks/useResource.js';
import { isRunActive, useRuns } from '../../hooks/useRuns.js';
import { defaultApiClient, type ApiClient, type Run } from '../../lib/api.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import type { RegisteredProject, RepoScan, RepoTool } from '../../lib/qa.js';
import { runDetailPath } from '../../route-manifest.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/runner',
  component: () => <RunnerPage qa={createQaClient()} api={defaultApiClient} />,
});

/**
 * The runner: every command the repository declares, runnable from here.
 *
 * ## What "run anything" means, and what it does not
 *
 * The list is the repository's own scripts and Makefile targets plus the detected test
 * suites, as the **server** scanned them. Pressing Run sends a tool id; the server
 * re-resolves it against its own scan and refuses an id it did not find. There is no
 * field anywhere on this page that could carry a command line, so the page can only ever
 * start something the repository already declares.
 *
 * Every run is confirmed first, with the exact argv and working directory on screen,
 * because a run executes on the runner host with the runner's permissions — and a QA
 * lead deciding to run `db:migrate` should see that it is `db:migrate` before it starts.
 */
export const TOOL_GROUPS = [
  { id: 'all', label: 'All', kinds: null },
  {
    id: 'tests',
    label: 'Tests',
    kinds: ['unit', 'integration', 'e2e', 'api', 'mobile', 'contract', 'visual', 'mutation'],
  },
  {
    id: 'quality',
    label: 'Quality',
    kinds: ['coverage', 'static-analysis', 'types', 'formatting', 'ci', 'test-management'],
  },
  { id: 'security', label: 'Security', kinds: ['sast', 'dast', 'secrets', 'dependencies'] },
  { id: 'experience', label: 'Perf & a11y', kinds: ['performance', 'accessibility'] },
  { id: 'build', label: 'Build & data', kinds: ['build', 'database', 'docs'] },
  { id: 'other', label: 'Other', kinds: ['dev', 'other'] },
] as const;
type GroupId = (typeof TOOL_GROUPS)[number]['id'];

export function inGroup(tool: RepoTool, group: GroupId): boolean {
  const kinds = TOOL_GROUPS.find((candidate) => candidate.id === group)?.kinds ?? null;
  return kinds === null || (kinds as readonly string[]).includes(tool.kind);
}

export function RunnerPage({ qa, api }: { qa: QaClient; api: ApiClient }): React.ReactElement {
  return (
    <ProjectGate qa={qa} title="Launch">
      {(project, switcher) => (
        <RunnerBody qa={qa} api={api} project={project} switcher={switcher} />
      )}
    </ProjectGate>
  );
}

function RunnerBody({
  qa,
  api,
  project,
  switcher,
}: {
  qa: QaClient;
  api: ApiClient;
  project: RegisteredProject;
  switcher: React.ReactNode;
}): React.ReactElement {
  const [generation, setGeneration] = React.useState(0);
  const scan = useResource<RepoScan>(
    () => qa.getScan(project.id, generation > 0),
    [qa, project.id, generation],
  );
  const { runs, refresh } = useRuns(api);
  const [selected, setSelected] = React.useState<RepoTool | null>(null);

  const runnable = scan.status === 'ready' ? scan.value.tools.filter((tool) => tool.runnable) : [];
  return (
    <PageFrame data-testid="runner-page">
      <PageHeader
        title="Launch"
        subtitle={
          scan.status === 'ready'
            ? `${String(runnable.length)} runnable of ${String(scan.value.tools.length)} tools declared in ${project.name}`
            : project.name
        }
        actions={
          <>
            {switcher}
            <Button
              variant="outline"
              data-testid="runner-rescan"
              onClick={() => setGeneration((value) => value + 1)}
              className="min-h-11"
            >
              <RefreshCw size={14} aria-hidden="true" />
              Rescan
            </Button>
          </>
        }
      />
      <p className="max-w-measure shrink-0 text-xs text-fg-muted">
        Only commands this repository declares can run. Each one runs on the runner host, as the
        runner’s user, after you confirm it.
      </p>
      {scan.status === 'ready' ? (
        <RunnerGrid tools={scan.value.tools} runs={runs} onRun={setSelected} />
      ) : scan.status === 'error' ? (
        <Quiet role="alert" data-testid="runner-error">
          The repository could not be scanned: {scan.message}
        </Quiet>
      ) : (
        <Quiet data-testid="runner-loading">Scanning {project.name}…</Quiet>
      )}
      <ConfirmRun
        qa={qa}
        project={project}
        tool={selected}
        onClose={() => setSelected(null)}
        onStarted={() => void refresh()}
      />
    </PageFrame>
  );
}

/**
 * Pinned tools, kept in this browser: the handful of commands a QA engineer runs ten times a
 * day sit at the top of every group rather than wherever the manifest put them.
 */
const PIN_KEY = 'automate-pinned-tools';

function readPins(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function usePins(): [Set<string>, (id: string) => void] {
  const [pins, setPins] = React.useState(readPins);
  const toggle = React.useCallback((id: string) => {
    setPins((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify([...next]));
      } catch {
        // A storage that refuses writes keeps the pin for this page only.
      }
      return next;
    });
  }, []);
  return [pins, toggle];
}

/** The tool a finished run executed, read from the id the server stored on the job. */
export function toolForRun(run: Run, tools: readonly RepoTool[]): RepoTool | undefined {
  const id = (run.configuration as { commandId?: unknown } | undefined)?.commandId;
  return typeof id === 'string' ? tools.find((tool) => tool.id === id && tool.runnable) : undefined;
}

function RunnerGrid({
  tools,
  runs,
  onRun,
}: {
  tools: RepoTool[];
  runs: Run[];
  onRun: (tool: RepoTool) => void;
}): React.ReactElement {
  const [group, setGroup] = React.useState<GroupId | 'pinned'>('all');
  const [query, setQuery] = React.useState('');
  const [pins, togglePin] = usePins();
  const needle = query.trim().toLowerCase();
  const visible = tools
    .filter(
      (tool) =>
        (group === 'pinned' ? pins.has(tool.id) : inGroup(tool, group)) &&
        (needle.length === 0 ||
          tool.label.toLowerCase().includes(needle) ||
          tool.workingDirectory.toLowerCase().includes(needle)),
    )
    // Pinned first, then the scan's own order.
    .sort((left, right) => Number(pins.has(right.id)) - Number(pins.has(left.id)));
  const [size, listRef] = useFitCount(58, 7);
  const pager = usePager(visible, size);
  const groups = [
    ...(pins.size > 0 ? [{ id: 'pinned' as const, label: 'Pinned', count: pins.size }] : []),
    ...TOOL_GROUPS.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      count: tools.filter((tool) => inGroup(tool, candidate.id)).length,
    })),
  ];

  const groupList = (
    <ul className="space-y-1">
      {groups.map((candidate) => (
        <li key={candidate.id}>
          <button
            type="button"
            data-testid={`group-${candidate.id}`}
            aria-pressed={group === candidate.id}
            onClick={() => setGroup(candidate.id)}
            className={cn(
              'flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              group === candidate.id ? 'bg-surface-muted text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {candidate.label}
            <span className="tabular-nums text-xs">{candidate.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const toolsPanel = (narrow: boolean) => (
    <Panel title="Tools" data-testid="runner-tools" className="flex-1">
      <div className="mb-2 flex shrink-0 gap-2">
        {narrow ? (
          <label className="shrink-0">
            <span className="sr-only">Group</span>
            <select
              data-testid="runner-group-select"
              value={group}
              onChange={(event) => setGroup(event.target.value as GroupId | 'pinned')}
              className="min-h-11 rounded-lg border border-border bg-surface px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              {groups.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {`${candidate.label} (${String(candidate.count)})`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Filter tools</span>
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="search"
            data-testid="runner-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name or folder"
            className="min-h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          />
        </label>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-hidden">
        {pager.items.length === 0 ? (
          <Quiet>{group === 'pinned' ? 'Nothing pinned yet.' : 'No tool matches.'}</Quiet>
        ) : (
          <ul className="divide-y divide-border">
            {pager.items.map((tool) => (
              <ToolRow
                key={tool.id}
                tool={tool}
                onRun={onRun}
                pinned={pins.has(tool.id)}
                onPin={() => togglePin(tool.id)}
              />
            ))}
          </ul>
        )}
      </div>
      <PagerControls pager={pager} label="tool" />
    </Panel>
  );

  const activity = <Activity runs={runs} tools={tools} onRun={onRun} />;
  return (
    <Responsive
      label="Runner sections"
      desktop={
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_19rem] gap-3">
          <Panel title="Groups">{groupList}</Panel>
          {toolsPanel(false)}
          {activity}
        </div>
      }
      panels={[
        { id: 'tools', label: 'Tools', node: toolsPanel(true) },
        { id: 'activity', label: 'Activity', node: activity },
      ]}
    />
  );
}

function ToolRow({
  tool,
  onRun,
  pinned,
  onPin,
}: {
  tool: RepoTool;
  onRun: (tool: RepoTool) => void;
  pinned: boolean;
  onPin: () => void;
}): React.ReactElement {
  return (
    <li data-testid={`tool-${tool.id}`} className="flex items-center gap-2 py-1 sm:gap-3">
      <span
        aria-hidden="true"
        className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted sm:inline-flex"
      >
        <KindIcon kind={tool.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm" title={tool.name}>
            {tool.name}
          </span>
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            {tool.kind}
          </Badge>
        </div>
        <div className="truncate text-xs text-fg-muted" title={tool.evidence}>
          {tool.workingDirectory === '.' ? 'root' : tool.workingDirectory} ·{' '}
          {tool.runnable ? tool.evidence : tool.reason}
        </div>
      </div>
      <button
        type="button"
        data-testid={`pin-${tool.id}`}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${tool.name}` : `Pin ${tool.name}`}
        onClick={onPin}
        className={cn(
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          pinned ? 'text-warning' : 'text-fg-muted',
        )}
      >
        <Star size={14} aria-hidden="true" fill={pinned ? 'currentColor' : 'none'} />
      </button>
      <CopyButton text={tool.label} label={tool.label} />
      <Button
        size="sm"
        variant={tool.runnable ? 'outline' : 'ghost'}
        disabled={!tool.runnable}
        data-testid={`run-${tool.id}`}
        aria-label={`Run ${tool.label}`}
        onClick={() => onRun(tool)}
        className="min-h-11 min-w-11"
      >
        <Play size={12} aria-hidden="true" />
        <span className="hidden sm:inline">Run</span>
      </Button>
    </li>
  );
}

const LINK =
  'rounded-sm no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

function outcomeTone(run: Run): 'success' | 'danger' | 'secondary' | 'default' {
  if (run.outcome === 'passed') return 'success';
  if (run.outcome === 'failed') return 'danger';
  if (isRunActive(run)) return 'default';
  return 'secondary';
}

/**
 * The latest runs, live, with one press to run any of them again.
 *
 * "Run again" re-opens the same confirmation as the list, for the tool the server recorded
 * on the job — never a replay of an argv from the browser.
 */
function Activity({
  runs,
  tools,
  onRun,
}: {
  runs: Run[];
  tools: readonly RepoTool[];
  onRun: (tool: RepoTool) => void;
}): React.ReactElement {
  const [shown, listRef] = useFitCount(52, 7);
  return (
    <Panel
      title="Activity"
      data-testid="runner-activity"
      className="flex-1"
      action={
        <Link
          to="/dashboard/runs"
          className={cn(
            LINK,
            '-my-3 inline-flex min-h-11 items-center px-1 text-xs text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg',
          )}
        >
          All runs
        </Link>
      }
    >
      <div ref={listRef} className="min-h-0 flex-1 overflow-hidden">
        {runs.length === 0 ? (
          <Quiet>No runs yet. Start one from the list.</Quiet>
        ) : (
          <ul className="space-y-1">
            {runs.slice(0, shown).map((run) => {
              const again = toolForRun(run, tools);
              return (
                <li
                  key={run.id}
                  data-testid={`activity-${run.id}`}
                  className="flex items-center gap-1"
                >
                  <a
                    href={runDetailPath(run.id)}
                    className="flex min-h-11 min-w-0 flex-1 items-center truncate rounded-sm text-sm no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    {run.suite ?? run.id.slice(0, 8)}
                  </a>
                  <Badge role="status" aria-live="polite" variant={outcomeTone(run)}>
                    {(run.outcome ?? run.phase).replace('_', ' ')}
                  </Badge>
                  {again === undefined ? null : (
                    <button
                      type="button"
                      data-testid={`again-${run.id}`}
                      aria-label={`Run ${again.label} again`}
                      title="Run again"
                      onClick={() => onRun(again)}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/**
 * The confirmation, with exactly what will run.
 *
 * argv is shown **token by token**, never joined into a line someone could paste into a
 * shell with different quoting rules. The idempotency key is minted once per opened
 * dialog, so a double click on Run is one run.
 */
function ConfirmRun({
  qa,
  project,
  tool,
  onClose,
  onStarted,
}: {
  qa: QaClient;
  project: RegisteredProject;
  tool: RepoTool | null;
  onClose: () => void;
  onStarted: () => void;
}): React.ReactElement {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [started, setStarted] = React.useState<{ runId: string; label: string } | null>(null);
  const key = React.useRef<string | null>(null);

  React.useEffect(() => {
    key.current = tool === null ? null : crypto.randomUUID();
    setError(null);
  }, [tool]);

  const confirm = async (): Promise<void> => {
    if (tool === null || key.current === null) return;
    setPending(true);
    setError(null);
    try {
      const run = await qa.startRun(project.id, tool.id, key.current);
      setStarted({ runId: run.runId, label: tool.label });
      onStarted();
      onClose();
    } catch (caught) {
      const detail = (caught as { detail?: unknown } | null)?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {started === null ? null : (
        <p
          data-testid="runner-started"
          role="status"
          className="max-w-measure shrink-0 text-sm text-success"
        >
          Queued {started.label}.{' '}
          <a
            href={runDetailPath(started.runId)}
            className="rounded-sm font-mono underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            Open the run
          </a>
        </p>
      )}
      <Dialog
        open={tool !== null}
        onOpenChange={(open) => (open ? undefined : onClose())}
        data-testid="confirm-run"
      >
        {tool === null ? null : (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Run {tool.name}?</DialogTitle>
              <DialogDescription>
                From {tool.source}, in{' '}
                {tool.workingDirectory === '.' ? 'the repository root' : tool.workingDirectory}.
              </DialogDescription>
            </DialogHeader>
            <ol aria-label="Command" className="flex flex-wrap gap-1.5">
              {tool.argv.map((token, index) => (
                <li
                  key={`${String(index)}-${token}`}
                  className="rounded-md bg-surface-muted px-2 py-1 font-mono text-xs"
                >
                  {token}
                </li>
              ))}
            </ol>
            <p className="mt-3 max-w-measure break-words font-mono text-xs text-fg-muted">
              {tool.evidence}
            </p>
            <p className="mt-3 max-w-measure text-xs text-fg-muted">
              The verdict is the exit code unless the command declares a result file. It runs on the
              runner host with the runner’s permissions.
            </p>
            {error === null ? null : (
              <p
                role="alert"
                data-testid="confirm-run-error"
                className="mt-3 max-w-measure text-sm text-danger"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} className="min-h-11">
                Cancel
              </Button>
              <Button
                data-testid="confirm-run-submit"
                loading={pending}
                onClick={() => void confirm()}
                className="min-h-11"
              >
                Run
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
