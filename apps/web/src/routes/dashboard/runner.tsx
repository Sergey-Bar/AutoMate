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
  Search,
  cn,
} from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import {
  PageFrame,
  PageHeader,
  Panel,
  PagerControls,
  Quiet,
  usePager,
  useViewportRows,
} from '../../components/kit.js';
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
    kinds: ['unit', 'integration', 'e2e', 'contract', 'visual', 'mutation'],
  },
  {
    id: 'quality',
    label: 'Quality',
    kinds: ['coverage', 'static-analysis', 'types', 'formatting', 'ci'],
  },
  { id: 'security', label: 'Security', kinds: ['sast', 'secrets', 'dependencies'] },
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
    <ProjectGate qa={qa} title="Runner">
      {(project) => <RunnerBody qa={qa} api={api} project={project} />}
    </ProjectGate>
  );
}

function RunnerBody({
  qa,
  api,
  project,
}: {
  qa: QaClient;
  api: ApiClient;
  project: RegisteredProject;
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
        title="Runner"
        subtitle={
          scan.status === 'ready'
            ? `${String(runnable.length)} runnable of ${String(scan.value.tools.length)} tools declared in ${project.name}`
            : project.name
        }
        actions={
          <Button
            variant="outline"
            data-testid="runner-rescan"
            onClick={() => setGeneration((value) => value + 1)}
            className="min-h-11"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Rescan
          </Button>
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

function RunnerGrid({
  tools,
  runs,
  onRun,
}: {
  tools: RepoTool[];
  runs: Run[];
  onRun: (tool: RepoTool) => void;
}): React.ReactElement {
  const [group, setGroup] = React.useState<GroupId>('all');
  const [query, setQuery] = React.useState('');
  const needle = query.trim().toLowerCase();
  const visible = tools.filter(
    (tool) =>
      inGroup(tool, group) &&
      (needle.length === 0 ||
        tool.label.toLowerCase().includes(needle) ||
        tool.workingDirectory.toLowerCase().includes(needle)),
  );
  // Header, notice, panel title, filter and pager: about 340px above and below the rows.
  const pager = usePager(visible, useViewportRows(340, 57));
  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[13rem_minmax(0,1fr)_19rem]">
      <Panel title="Groups">
        <ul className="space-y-1">
          {TOOL_GROUPS.map((candidate) => {
            const count = tools.filter((tool) => inGroup(tool, candidate.id)).length;
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  data-testid={`group-${candidate.id}`}
                  aria-pressed={group === candidate.id}
                  onClick={() => setGroup(candidate.id)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                    group === candidate.id
                      ? 'bg-surface-muted text-fg'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {candidate.label}
                  <span className="tabular-nums text-xs">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="Tools" data-testid="runner-tools">
        <label className="relative mb-2 block shrink-0">
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
        {pager.items.length === 0 ? (
          <Quiet>No tool matches.</Quiet>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border">
            {pager.items.map((tool) => (
              <ToolRow key={tool.id} tool={tool} onRun={onRun} />
            ))}
          </ul>
        )}
        <PagerControls pager={pager} label="tool" />
      </Panel>
      <Activity runs={runs} />
    </div>
  );
}

function ToolRow({
  tool,
  onRun,
}: {
  tool: RepoTool;
  onRun: (tool: RepoTool) => void;
}): React.ReactElement {
  return (
    <li data-testid={`tool-${tool.id}`} className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm">{tool.name}</span>
          <Badge variant="outline">{tool.kind}</Badge>
        </div>
        <div className="truncate text-xs text-fg-muted" title={tool.evidence}>
          {tool.workingDirectory === '.' ? 'root' : tool.workingDirectory} ·{' '}
          {tool.runnable ? tool.evidence : tool.reason}
        </div>
      </div>
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
        Run
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

/** The latest runs, live: the stream pushes each phase, so a run started here is watched here. */
function Activity({ runs }: { runs: Run[] }): React.ReactElement {
  return (
    <Panel
      title="Activity"
      data-testid="runner-activity"
      action={
        <Link to="/dashboard/runs" className={cn(LINK, 'text-xs text-accent')}>
          All runs
        </Link>
      }
    >
      {runs.length === 0 ? (
        <Quiet>No runs yet. Start one from the list.</Quiet>
      ) : (
        <ul className="space-y-2">
          {runs.slice(0, 7).map((run) => (
            <li key={run.id} data-testid={`activity-${run.id}`} className="flex items-center gap-2">
              <a
                href={runDetailPath(run.id)}
                className="min-w-0 flex-1 truncate rounded-sm text-sm no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                {run.suite ?? run.id.slice(0, 8)}
              </a>
              <Badge role="status" aria-live="polite" variant={outcomeTone(run)}>
                {(run.outcome ?? run.phase).replace('_', ' ')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
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
