import React from 'react';
import {
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import type {
  AgentRuntimeReport,
  EvalRunDetail,
  EvalRunSummary,
  EvalSuiteStatus,
  McpServerList,
  ProjectEvals,
} from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import type { AgentsClient, EvalDatasetList } from '../lib/agents-client.js';
import type { HealthClient } from '../lib/health-client.js';
import { ago } from '../lib/health-view.js';
import { formatDuration } from '../lib/insights.js';
import type { QaClient } from '../lib/qa-client.js';
import { canOperate, failureText } from '../lib/roles.js';
import { formatMetricValue } from '../lib/scorecard-view.js';
import { PageFrame, PageHeader, Panel, Quiet, Segmented } from './kit.js';
import { Loaded, ProjectPage, type ProjectContext } from './ProjectPage.js';
import { ScorecardCard } from './ScorecardCard.js';
import { StatusLine } from './StatusLine.js';
import { useToast } from './Toasts.js';

/**
 * Agent quality: whether the repository's agents regress, what they cost to run, which tools
 * they are given — and the same runtime figures for Automate's own chat.
 *
 * Every verdict is the server's: a suite's comparison decides `pass`, `fail` or
 * `insufficient` with intervals, and only a `significant` regression is listed as one. A
 * prompt is never shown here, and an MCP server's environment is shown by key name only.
 */
const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const;
type WindowValue = (typeof WINDOWS)[number]['value'];

export function AgentsPage({
  qa,
  health,
  agents,
  projectId,
}: {
  qa: QaClient;
  health: HealthClient;
  agents: AgentsClient;
  projectId?: string | undefined;
}): React.ReactElement {
  return (
    <ProjectPage qa={qa} health={health} title="Agents" projectId={projectId}>
      {(context) => <AgentsBody context={context} agents={agents} />}
    </ProjectPage>
  );
}

function AgentsBody({
  context,
  agents,
}: {
  context: ProjectContext;
  agents: AgentsClient;
}): React.ReactElement {
  const { project, switcher, who } = context;
  const [days, setDays] = React.useState<WindowValue>('7');
  const [branchDraft, setBranchDraft] = React.useState('');
  const [branch, setBranch] = React.useState<string | undefined>(undefined);
  const [openRun, setOpenRun] = React.useState<string | null>(null);
  const ids = React.useId();
  const evals = useResource<ProjectEvals>(
    () => agents.getEvals(project.id, branch),
    [agents, project.id, branch],
  );
  return (
    <PageFrame data-testid="agents-page" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Agents"
        subtitle={`Evals, runtime and tools for ${project.name}`}
        actions={
          <>
            {switcher}
            <form
              aria-label="Branch"
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setBranch(branchDraft.trim() === '' ? undefined : branchDraft.trim());
              }}
            >
              <Input
                id={`${ids}-branch`}
                label="Branch"
                value={branchDraft}
                placeholder="default branch"
                onChange={(event) => setBranchDraft(event.target.value)}
              />
              <Button type="submit" variant="outline" className="min-h-11">
                Compare
              </Button>
            </form>
            <Segmented label="Runtime window" options={WINDOWS} value={days} onChange={setDays} />
          </>
        }
      />
      <Loaded resource={evals} label="the evals" testId="evals">
        {(value) => <EvalsView evals={value} onOpenRun={setOpenRun} />}
      </Loaded>
      <RuntimePanel agents={agents} projectId={project.id} days={Number(days)} />
      <div className="grid gap-3 lg:grid-cols-2">
        <McpPanel agents={agents} projectId={project.id} branch={branch} />
        <DatasetsPanel agents={agents} projectId={project.id} operator={canOperate(who)} />
      </div>
      <ChatRuntimePanel agents={agents} days={Number(days)} />
      {openRun === null ? null : (
        <RunDrawer
          agents={agents}
          projectId={project.id}
          runId={openRun}
          onClose={() => setOpenRun(null)}
        />
      )}
    </PageFrame>
  );
}

/** Suites whose comparison or scorecard fails. Insufficient is not failing. */
export function failingSuites(evals: ProjectEvals): number {
  return evals.suites.filter(
    (suite) => suite.comparison?.verdict === 'fail' || suite.scorecard.status === 'fail',
  ).length;
}

function EvalsView({
  evals,
  onOpenRun,
}: {
  evals: ProjectEvals;
  onOpenRun: (runId: string) => void;
}): React.ReactElement {
  const failing = failingSuites(evals);
  if (evals.suites.length === 0) {
    return (
      <Quiet data-testid="evals-empty">
        {`No eval suite has reported on ${evals.branch}. Upload a promptfoo, DeepEval or Inspect report from CI, or run a dataset below.`}
      </Quiet>
    );
  }
  return (
    <>
      <StatusLine
        data-testid="agents-status"
        value={String(failing)}
        tone={failing === 0 ? 'good' : 'bad'}
        sentence={`of ${String(evals.suites.length)} eval suite${evals.suites.length === 1 ? '' : 's'} on ${evals.branch} ${failing === 1 ? 'fails' : 'fail'} against ${evals.defaultBranch}.`}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {evals.suites.map((suite) => (
          <SuiteCard key={suite.suite} suite={suite} onOpenRun={onOpenRun} />
        ))}
      </div>
      <RecentRuns runs={evals.runs} onOpenRun={onOpenRun} />
    </>
  );
}

const VERDICT_VARIANT = { pass: 'success', fail: 'danger', insufficient: 'outline' } as const;
const VERDICT_WORD = { pass: 'Pass', fail: 'Fail', insufficient: 'Too little data' } as const;

function SuiteCard({
  suite,
  onOpenRun,
}: {
  suite: EvalSuiteStatus;
  onOpenRun: (runId: string) => void;
}): React.ReactElement {
  const { comparison } = suite;
  return (
    <Panel
      title={`Suite: ${suite.suite}`}
      data-testid={`suite-${suite.suite}`}
      action={
        comparison === null ? (
          <Badge variant="outline">No baseline</Badge>
        ) : (
          <Badge variant={VERDICT_VARIANT[comparison.verdict]}>
            {VERDICT_WORD[comparison.verdict]}
          </Badge>
        )
      }
    >
      <ScorecardCard scorecard={suite.scorecard} compact headingLevel={3} />
      {comparison === null ? (
        <p className="mt-2 text-xs text-fg-muted">
          {suite.baseline === null
            ? 'Nothing on the default branch to compare against.'
            : 'This is the default branch: there is nothing to compare it with.'}
        </p>
      ) : (
        <SuiteComparison comparison={comparison} />
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 self-start"
        onClick={() => onOpenRun(suite.latest.id)}
        aria-label={`Open the latest run of ${suite.suite}`}
      >
        Open latest run
      </Button>
    </Panel>
  );
}

function SuiteComparison({
  comparison,
}: {
  comparison: NonNullable<EvalSuiteStatus['comparison']>;
}): React.ReactElement {
  const significant = comparison.regressions.filter((change) => change.significant);
  return (
    <div className="mt-3 space-y-2 text-sm">
      <div data-testid="significant-regressions">
        <h4 className="text-xs font-medium text-fg-muted">Significant regressions</h4>
        {significant.length === 0 ? (
          <p className="text-xs text-fg-muted">None.</p>
        ) : (
          <ul className="space-y-0.5">
            {significant.map((change) => (
              <li key={change.caseId} className="flex justify-between gap-2">
                <span className="font-mono text-xs">{change.caseId}</span>
                <span className="tabular-nums text-xs text-danger">
                  {`${percent(change.baselinePassRate)} → ${percent(change.candidatePassRate)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div data-testid="flaky-cases">
        <h4 className="text-xs font-medium text-fg-muted">Flaky cases</h4>
        <p className="text-xs">
          {comparison.flaky.length === 0 ? 'None.' : comparison.flaky.join(', ')}
        </p>
      </div>
    </div>
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function RecentRuns({
  runs,
  onOpenRun,
}: {
  runs: readonly EvalRunSummary[];
  onOpenRun: (runId: string) => void;
}): React.ReactElement {
  return (
    <Panel title="Recent eval runs" data-testid="eval-runs">
      <Table aria-label="Recent eval runs">
        <TableHeader>
          <TableRow>
            <TableHead>Suite</TableHead>
            <TableHead>Passed</TableHead>
            <TableHead className="hidden md:table-cell">Model</TableHead>
            <TableHead className="hidden md:table-cell">Received</TableHead>
            <TableHead>
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id} data-testid={`eval-run-${run.id}`}>
              <TableCell className="font-mono text-xs">{run.suite}</TableCell>
              <TableCell
                numeric
              >{`${String(run.totals.passed)} / ${String(run.totals.attempts)}`}</TableCell>
              <TableCell className="hidden text-xs md:table-cell">{run.model ?? '—'}</TableCell>
              <TableCell className="hidden text-xs md:table-cell">{ago(run.receivedAt)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenRun(run.id)}
                  aria-label={`Open run ${run.id}`}
                >
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

function RunDrawer({
  agents,
  projectId,
  runId,
  onClose,
}: {
  agents: AgentsClient;
  projectId: string;
  runId: string;
  onClose: () => void;
}): React.ReactElement {
  const run = useResource<EvalRunDetail>(
    () => agents.getEvalRun(projectId, runId),
    [agents, projectId, runId],
  );
  return (
    <Drawer
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      aria-labelledby="eval-run-title"
    >
      <DrawerContent data-testid="eval-run-drawer">
        <DrawerHeader>
          <DrawerTitle id="eval-run-title" className="break-all font-mono text-base">
            {`Eval run ${runId}`}
          </DrawerTitle>
        </DrawerHeader>
        <Loaded resource={run} label="the run" testId="eval-run">
          {(value) => <RunDetail run={value} />}
        </Loaded>
        <Button variant="outline" className="mt-4 min-h-11" onClick={onClose}>
          Close
        </Button>
      </DrawerContent>
    </Drawer>
  );
}

function attemptWord(passed: boolean | null): string {
  if (passed === null) return 'not judged';
  return passed ? 'passed' : 'failed';
}

function RunDetail({ run }: { run: EvalRunDetail }): React.ReactElement {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-fg-muted">
        {`${run.suite} · ${run.branch}${run.commitSha === null ? '' : ` @ ${run.commitSha.slice(0, 7)}`} · ${run.tool.name} · ${run.model ?? 'no model'}`}
      </p>
      {run.truncated ? (
        <p className="text-xs text-warning">The report had more cases than were kept.</p>
      ) : null}
      <ul className="divide-y divide-border" aria-label="Cases">
        {run.cases.map((entry) => (
          <li key={entry.caseId} className="py-2" data-testid={`case-${entry.caseId}`}>
            <p className="font-mono text-xs">{entry.label === '' ? entry.caseId : entry.label}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
              {entry.attempts.map((attempt) => (
                <li key={attempt.epoch}>
                  {`Attempt ${String(attempt.epoch + 1)}: ${attemptWord(attempt.passed)}`}
                  {attempt.latencyMs === null ? '' : ` · ${formatDuration(attempt.latencyMs)}`}
                  {attempt.error === null ? '' : ` · ${attempt.error}`}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

type RuntimeRow = AgentRuntimeReport['runtime']['agents'][number];

function intervalText(rate: RuntimeRow['current']['errors']['rate']): string {
  if (rate === null) return 'too little data';
  return `${percent(rate.estimate)} (${percent(rate.low)}–${percent(rate.high)})`;
}

function orNone(value: number | null, format: (value: number) => string): string {
  return value === null ? '—' : format(value);
}

function RuntimeTable({
  rows,
  label,
}: {
  rows: readonly RuntimeRow[];
  label: string;
}): React.ReactElement {
  if (rows.length === 0)
    return <Quiet>{`No ${label.toLowerCase()} reported a run in this window.`}</Quiet>;
  return (
    <Table aria-label={`Runtime by ${label.toLowerCase()}`}>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          <TableHead>Runs</TableHead>
          <TableHead>Cost per run</TableHead>
          <TableHead className="hidden md:table-cell">Tokens per run</TableHead>
          <TableHead className="hidden md:table-cell">p95</TableHead>
          <TableHead>Errors</TableHead>
          <TableHead className="hidden lg:table-cell">Tool failures</TableHead>
          <TableHead>Loops</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key} data-testid={`runtime-${row.key}`}>
            <TableCell className="font-mono text-xs">{row.key}</TableCell>
            <TableCell numeric>{row.current.runs}</TableCell>
            <TableCell numeric>
              {orNone(row.current.costPerRunUsd, (value) => formatMetricValue(value, 'usd'))}
              {row.current.cost.unknownSpans === 0 ? null : (
                <span className="block text-xs text-fg-muted">{`${String(row.current.cost.unknownSpans)} unpriced`}</span>
              )}
            </TableCell>
            <TableCell numeric className="hidden md:table-cell">
              {orNone(row.current.tokensPerRun, (value) => formatMetricValue(value, 'tokens'))}
            </TableCell>
            <TableCell numeric className="hidden md:table-cell">
              {orNone(row.current.latency.p95Ms, formatDuration)}
            </TableCell>
            <TableCell numeric>{intervalText(row.current.errors.rate)}</TableCell>
            <TableCell numeric className="hidden lg:table-cell">
              {intervalText(row.current.toolCalls.rate)}
            </TableCell>
            <TableCell numeric className={row.current.loops > 0 ? 'text-warning' : undefined}>
              {row.current.loops}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RuntimePanel({
  agents,
  projectId,
  days,
}: {
  agents: AgentsClient;
  projectId: string;
  days: number;
}): React.ReactElement {
  const runtime = useResource<AgentRuntimeReport>(
    () => agents.getRuntime(projectId, days),
    [agents, projectId, days],
  );
  return (
    <Panel title="Agent runtime" data-testid="agent-runtime">
      <Loaded resource={runtime} label="the agent runtime" testId="agent-runtime">
        {(value) => <RuntimeView report={value} />}
      </Loaded>
    </Panel>
  );
}

function RuntimeView({ report }: { report: AgentRuntimeReport }): React.ReactElement {
  const { runtime } = report;
  if (runtime.overall.current.runs === 0) {
    return (
      <Quiet data-testid="runtime-empty">
        No agent run arrived in this window. Agents report runtime by exporting OTLP traces to
        Automate.
      </Quiet>
    );
  }
  return (
    <div className="space-y-4">
      {report.truncated ? (
        <p className="text-xs text-warning">
          More spans arrived than were read; these describe the newest.
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <ScorecardCard scorecard={report.scorecard} headingLevel={3} />
        <div className="space-y-4">
          <RuntimeTable rows={runtime.agents} label="Agent" />
          <RuntimeTable rows={runtime.models} label="Model" />
        </div>
      </div>
      <Loops loops={runtime.loops} />
    </div>
  );
}

function Loops({ loops }: { loops: AgentRuntimeReport['runtime']['loops'] }): React.ReactElement {
  return (
    <div data-testid="runtime-loops">
      <h3 className="text-xs font-medium uppercase tracking-wider text-fg-muted">Loops</h3>
      {loops.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No agent called the same tool with the same arguments repeatedly.
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {loops.map((loop) => (
            <li key={`${loop.traceId}-${loop.toolArgsHash}`}>
              <span className="font-mono text-xs">{loop.agent}</span>
              {` called ${loop.toolName} ${String(loop.count)} times with the same arguments`}
              <span className="ml-1 font-mono text-xs text-fg-muted">{`trace ${loop.traceId}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function McpPanel({
  agents,
  projectId,
  branch,
}: {
  agents: AgentsClient;
  projectId: string;
  branch: string | undefined;
}): React.ReactElement {
  const servers = useResource<McpServerList>(
    () => agents.getMcpServers(projectId, branch),
    [agents, projectId, branch],
  );
  return (
    <Panel title="MCP servers" data-testid="mcp-servers">
      <Loaded resource={servers} label="the MCP inventory" testId="mcp">
        {(value) => <McpTable list={value} />}
      </Loaded>
    </Panel>
  );
}

function serverSource(server: McpServerList['servers'][number]): string {
  if (server.package !== null) {
    return server.version === null ? server.package : `${server.package}@${server.version}`;
  }
  return server.url ?? server.command ?? '—';
}

function McpTable({ list }: { list: McpServerList }): React.ReactElement {
  if (list.servers.length === 0) {
    return (
      <Quiet data-testid="mcp-empty">
        {`No MCP server is configured on ${list.branch}, or no agent configuration was scanned.`}
      </Quiet>
    );
  }
  return (
    <ul className="divide-y divide-border text-sm">
      {list.servers.map((server) => (
        <li
          key={`${server.configPath}-${server.name}`}
          className="py-2"
          data-testid={`mcp-${server.name}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{server.name}</span>
            <Badge variant="outline">{server.transport}</Badge>
            <Badge variant={server.pinned ? 'secondary' : 'warning'}>
              {server.pinned ? 'Pinned' : 'Not pinned'}
            </Badge>
          </div>
          <p className="break-all font-mono text-xs text-fg-muted">{serverSource(server)}</p>
          <p className="text-xs text-fg-muted">
            {`${server.configPath} · env: ${server.envKeys.length === 0 ? 'none' : server.envKeys.join(', ')}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DatasetsPanel({
  agents,
  projectId,
  operator,
}: {
  agents: AgentsClient;
  projectId: string;
  operator: boolean;
}): React.ReactElement {
  const datasets = useResource<EvalDatasetList>(
    () => agents.getDatasets(projectId),
    [agents, projectId],
  );
  return (
    <Panel title="Eval datasets" data-testid="datasets">
      <Loaded resource={datasets} label="the datasets" testId="datasets">
        {(value) =>
          value.datasets.length === 0 ? (
            <Quiet data-testid="datasets-empty">
              No dataset is saved. A dataset is created with POST
              /api/v1/projects/:id/evals/datasets.
            </Quiet>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {value.datasets.map((dataset) => (
                <DatasetRow
                  key={dataset.id}
                  agents={agents}
                  projectId={projectId}
                  dataset={dataset}
                  operator={operator}
                />
              ))}
            </ul>
          )
        }
      </Loaded>
    </Panel>
  );
}

function DatasetRow({
  agents,
  projectId,
  dataset,
  operator,
}: {
  agents: AgentsClient;
  projectId: string;
  dataset: EvalDatasetList['datasets'][number];
  operator: boolean;
}): React.ReactElement {
  const toast = useToast();
  const [state, setState] = React.useState<'idle' | 'busy' | 'started'>('idle');
  const run = () => {
    setState('busy');
    agents
      .runDataset(projectId, dataset.id)
      .then((started) => {
        setState('started');
        toast({
          tone: 'success',
          title: `Started ${started.suite}`,
          description: `${String(started.attempts)} attempts on ${started.branch}; the result arrives as an eval run.`,
        });
      })
      .catch((error: unknown) => {
        setState('idle');
        toast({
          tone: 'danger',
          title: 'The dataset did not start',
          description: failureText(error, 'The run could not start'),
        });
      });
  };
  return (
    <li
      className="flex items-center justify-between gap-3 py-2"
      data-testid={`dataset-${dataset.id}`}
    >
      <div className="min-w-0">
        <p className="truncate">{dataset.name}</p>
        <p className="text-xs text-fg-muted">
          {`${String(dataset.cases.length)} cases × ${String(dataset.repeats)} · ${dataset.model}${dataset.judge === null ? '' : ' · judged'}`}
        </p>
      </div>
      {state === 'started' ? (
        <span role="status" className="shrink-0 text-xs text-success">
          Started
        </span>
      ) : null}
      {operator && state !== 'started' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={state === 'busy'}
          onClick={run}
          aria-label={`Run ${dataset.name}`}
          className="min-h-11 shrink-0"
        >
          {state === 'busy' ? 'Starting…' : 'Run'}
        </Button>
      ) : null}
    </li>
  );
}

function ChatRuntimePanel({
  agents,
  days,
}: {
  agents: AgentsClient;
  days: number;
}): React.ReactElement {
  const runtime = useResource<AgentRuntimeReport>(
    () => agents.getChatRuntime(days),
    [agents, days],
  );
  return (
    <Panel title="Automate's own chat" data-testid="chat-runtime" data-chrome="secondary">
      <Loaded resource={runtime} label="the chat runtime" testId="chat-runtime">
        {(value) => <ChatRuntime report={value} />}
      </Loaded>
    </Panel>
  );
}

function ChatRuntime({ report }: { report: AgentRuntimeReport }): React.ReactElement {
  const overall = report.runtime.overall.current;
  if (overall.runs === 0) {
    return <Quiet data-testid="chat-runtime-empty">The chat has not run in this window.</Quiet>;
  }
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <ScorecardCard scorecard={report.scorecard} compact headingLevel={3} />
      <RuntimeTable rows={report.runtime.models} label="Model" />
    </div>
  );
}
