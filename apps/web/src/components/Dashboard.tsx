import React from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkline, cn } from '@automate/ui';
import { SCORE_CATEGORIES, SCORE_SURFACES, type ScoreCell } from '@automate/shared-contracts';
import { useResource, type Resource } from '../hooks/useResource.js';
import { repoHealthPath } from '../route-manifest.js';
import type { ApiClient, QuarantineEntry } from '../lib/api.js';
import {
  compareWindows,
  formatDelta,
  formatDuration,
  formatPercent,
  orDash,
  tally,
  type Comparison,
} from '../lib/insights.js';
import type { QaClient } from '../lib/qa-client.js';
import type {
  AnalyticsTrend,
  QaGapsResponse,
  QaInsights,
  QaScore,
  RegisteredProject,
  ReleaseReadinessCard,
  RepoReport,
  RepoScan,
} from '../lib/qa.js';
import {
  Delta,
  Kpi,
  PageFrame,
  PageHeader,
  Panel,
  Quiet,
  Segmented,
  StatusDot,
  useFitCount,
} from './kit.js';
import { ProjectGate } from './ProjectGate.js';
import { FindingsColumns, VerdictHero } from './Readiness.js';
import { summarizeHealth, type HealthSummary } from '../lib/health-summary.js';
import { Responsive } from './responsive.js';
import { TrendChart } from './TrendChart.js';

/**
 * The Overview: can I ship, what is wrong, what is good — and then the detail.
 *
 * ## Read top to bottom, and stop when you have the answer
 *
 * 1. **The verdict** — Go, Caution or No-go at display size, with the reason that set it.
 * 2. **What's wrong beside what's good** — every readiness reason, the week's news and the
 *    score's gap queue, ranked, each with its evidence and one next action
 *    (`lib/health-summary.ts`).
 * 3. **The six figures** — health, pass rate, volume, speed, flakiness, maturity — each
 *    with the change since the window before it.
 * 4. **The detail** — the trend, before versus now, the health matrix, the next actions
 *    and the reports on disk, in a fixed-height grid so the paged lists keep their size.
 *
 * Most readers stop after the first two. The page scrolls, deliberately: the answer is
 * above the fold and the detail is below it, rather than everything squeezed into one
 * viewport.
 *
 * ## Every read settles on its own
 *
 * Five endpoints, and one failing names itself while the other four render. A screen
 * that empties when one read fails reads the failure as "there is nothing here", which is
 * the one conclusion a failure must never support. The trend is a separate resource
 * because changing the window must not refetch the score.
 */
interface Reading<T> {
  value: T | null;
  failure: string | null;
}

interface Snapshot {
  score: Reading<QaScore>;
  gaps: Reading<QaGapsResponse>;
  scan: Reading<RepoScan>;
  quarantine: Reading<QuarantineEntry[]>;
}

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const;
type WindowValue = (typeof WINDOWS)[number]['value'];

export function Dashboard({
  qa,
  api,
  projectId,
}: {
  qa: QaClient;
  api: ApiClient;
  projectId?: string;
}): React.ReactElement {
  return (
    <ProjectGate qa={qa} title="Overview" projectId={projectId}>
      {(project, switcher) => (
        <DashboardBody qa={qa} api={api} project={project} switcher={switcher} />
      )}
    </ProjectGate>
  );
}

function DashboardBody({
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
  const [days, setDays] = React.useState<WindowValue>('14');
  const snapshot = useResource<Snapshot>(
    (signal) => loadSnapshot(api, qa, project.id, signal),
    [api, qa, project.id],
  );
  const trend = useResource<AnalyticsTrend>(() => qa.getTrend(Number(days)), [qa, days]);
  // Their own resources, so a readiness or insights read that fails names itself in the strip
  // and leaves the rest of the screen as it was.
  const readiness = useResource<ReleaseReadinessCard>(
    () => qa.getReadiness(project.id, 7),
    [qa, project.id],
  );
  const insights = useResource<QaInsights>(
    () => qa.getInsights(Number(days), project.id),
    [qa, days, project.id],
  );

  const summary = overviewSummary(project.id, readiness, insights, snapshot);

  return (
    <PageFrame data-testid="dashboard" className="h-auto gap-4 sm:gap-6">
      <PageHeader
        title="Overview"
        subtitle={
          <span data-testid="dashboard-subject">
            {project.name} · {project.repoPath ?? 'no repository path recorded'}
          </span>
        }
        actions={
          <>
            <a
              href={repoHealthPath(project.id)}
              data-testid="dashboard-repo-health"
              className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-3 text-sm text-fg no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Repository health
            </a>
            {switcher}
            <Segmented
              label="Comparison window"
              options={WINDOWS}
              value={days}
              onChange={setDays}
            />
          </>
        }
      />
      <VerdictHero
        summary={readiness.status === 'ready' ? summary : null}
        failure={readiness.status === 'error' ? readiness.message : null}
      />
      {summary === null || snapshot.status === 'loading' ? null : (
        <FindingsColumns summary={summary} />
      )}
      {snapshot.status === 'ready' ? (
        <DashboardGrid
          snapshot={snapshot.value}
          projectId={project.id}
          trend={trend.status === 'ready' ? trend.value : null}
          trendFailure={trend.status === 'error' ? trend.message : null}
        />
      ) : snapshot.status === 'error' ? (
        <Quiet role="alert" data-testid="dashboard-load-error">
          Could not read the dashboard: {snapshot.message}
        </Quiet>
      ) : (
        <Quiet data-testid="dashboard-loading">Reading {project.name}…</Quiet>
      )}
    </PageFrame>
  );
}

/** What is wrong and what is good, from whichever reads have settled. `null` until readiness has. */
function overviewSummary(
  projectId: string,
  readiness: Resource<ReleaseReadinessCard>,
  insights: Resource<QaInsights>,
  snapshot: Resource<Snapshot>,
): HealthSummary | null {
  if (readiness.status === 'loading') return null;
  return summarizeHealth({
    projectId,
    readiness: readiness.status === 'ready' ? readiness.value : null,
    digest: insights.status === 'ready' ? insights.value.digest : [],
    gaps: snapshot.status === 'ready' ? snapshot.value.gaps.value : null,
  });
}

async function loadSnapshot(
  api: ApiClient,
  qa: QaClient,
  projectId: string,
  signal: AbortSignal,
): Promise<Snapshot> {
  const [score, gaps, scan, quarantine] = await Promise.allSettled([
    qa.getScore(projectId),
    qa.getGaps(projectId),
    qa.getScan(projectId),
    api.getQuarantine({ signal }),
  ]);
  return { score: read(score), gaps: read(gaps), scan: read(scan), quarantine: read(quarantine) };
}

/** The endpoint's own sentence, not `error.message` — see `useResource.ts`. */
export function read<T>(settled: PromiseSettledResult<T>): Reading<T> {
  if (settled.status === 'fulfilled') return { value: settled.value, failure: null };
  const detail = (settled.reason as { detail?: unknown } | null)?.detail;
  const message =
    typeof detail === 'string' && detail.length > 0
      ? detail
      : settled.reason instanceof Error
        ? settled.reason.message
        : String(settled.reason);
  return { value: null, failure: message };
}

const ENDPOINTS: Record<keyof Snapshot, string> = {
  score: 'qa/score',
  gaps: 'qa/gaps',
  scan: 'scan',
  quarantine: 'quarantine',
};

function DashboardGrid({
  snapshot,
  trend,
  trendFailure,
  projectId,
}: {
  projectId: string;
  snapshot: Snapshot;
  trend: AnalyticsTrend | null;
  trendFailure: string | null;
}): React.ReactElement {
  const failed = (Object.keys(ENDPOINTS) as Array<keyof Snapshot>).filter(
    (name) => snapshot[name].failure !== null,
  );
  const comparisons = trend === null ? [] : compareWindows(trend.previous, trend.current);
  const trendPanel = (className: string) => (
    <Panel
      title={
        trend === null
          ? 'Pass rate and volume'
          : `Pass rate and volume · last ${String(trend.days)} days`
      }
      className={className}
      data-testid="dashboard-trend"
    >
      {trend === null ? (
        <Quiet>{trendFailure ?? 'Reading run history…'}</Quiet>
      ) : (
        <TrendChart buckets={trend.buckets} data-testid="trend-chart" />
      )}
    </Panel>
  );
  const beforeNow = <BeforeNow comparisons={comparisons} trend={trend} />;
  const matrix = <Matrix score={snapshot.score.value} />;
  const actions = (
    <NextActions gaps={snapshot.gaps.value} scan={snapshot.scan.value} projectId={projectId} />
  );
  const reports = <Reports scan={snapshot.scan.value} />;
  return (
    <>
      <h2 className="sr-only">The detail</h2>
      {failed.length > 0 ? (
        <p
          role="alert"
          data-testid="dashboard-failures"
          className="max-w-measure shrink-0 truncate text-xs text-warning"
        >
          {failed.map((name) => `${ENDPOINTS[name]}: ${snapshot[name].failure ?? ''}`).join(' · ')}.
          A missing figure is a read that failed, not a measurement of zero.
        </p>
      ) : null}
      <Figures snapshot={snapshot} trend={trend} comparisons={comparisons} />
      {/*
        A fixed height at every width: the paged lists inside measure their panel, and a
        panel whose height came from its own list would measure itself.
      */}
      <div className="flex h-[34rem] shrink-0 flex-col xl:h-auto">
        <Responsive
          label="Overview detail"
          desktop={
            <div className="grid h-[44rem] shrink-0 grid-cols-3 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
              {trendPanel('col-span-2')}
              {beforeNow}
              {matrix}
              {actions}
              {reports}
            </div>
          }
          panels={[
            { id: 'trend', label: 'Trend', node: trendPanel('flex-1') },
            { id: 'compare', label: 'Before vs now', node: beforeNow },
            { id: 'matrix', label: 'Matrix', node: matrix },
            { id: 'actions', label: 'Actions', node: actions },
            { id: 'reports', label: 'Reports', node: reports },
          ]}
        />
      </div>
    </>
  );
}

function band(value: number): 'good' | 'warn' | 'bad' {
  if (value >= 0.6) return 'good';
  if (value >= 0.3) return 'warn';
  return 'bad';
}

const TONE = { good: 'text-success', warn: 'text-warning', bad: 'text-danger' } as const;

function deltaFooter(comparison: Comparison | undefined): React.ReactNode {
  if (comparison === undefined || comparison.delta === null) return 'no earlier window to compare';
  return (
    <>
      <Delta
        text={formatDelta(comparison)}
        verdict={comparison.verdict}
        rising={comparison.delta === 0 ? null : comparison.delta > 0}
      />{' '}
      vs previous window
    </>
  );
}

/**
 * A day-by-day sparkline for one figure, or nothing when fewer than two days have a value —
 * one point has no shape, and a flat line drawn from it would claim a trend.
 */
function spark(
  trend: AnalyticsTrend | null,
  key: 'passRate' | 'runs' | 'avgDurationMs',
  label: string,
  tone: string,
): React.ReactNode {
  const points = (trend?.buckets ?? [])
    .map((bucket) => bucket[key])
    .filter((value): value is number => value !== null);
  if (points.length < 2) return undefined;
  return <Sparkline points={points} label={label} tone={tone} />;
}

function Figures({
  snapshot,
  trend,
  comparisons,
}: {
  snapshot: Snapshot;
  trend: AnalyticsTrend | null;
  comparisons: Comparison[];
}): React.ReactElement {
  const find = (key: string) => comparisons.find((entry) => entry.key === key);
  const score = snapshot.score.value;
  const scan = snapshot.scan.value;
  const current = trend?.current ?? null;
  // Weighted capabilities only: mobile and test management are optional, and counting them
  // would tell a web service it is missing a device lab.
  const counted = scan?.capabilities.filter((entry) => entry.weight > 0) ?? [];
  const covered = counted.filter((entry) => entry.covered).length;
  return (
    <section
      aria-label="Key figures"
      className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6"
    >
      <Kpi
        data-testid="kpi-health"
        label="QA health"
        value={score === null ? '—' : score.total.toFixed(0)}
        unit="/ 100"
        tone={score === null ? undefined : TONE[band(score.total / 100)]}
        footer={
          score === null
            ? 'score unread'
            : `limited by ${score.cappedBy} at ${score.cappingValue.toFixed(2)}`
        }
      />
      <Kpi
        data-testid="kpi-pass-rate"
        label="Pass rate · all projects"
        value={orDash(current?.passRate ?? null, (value) => value.toFixed(1))}
        {...(current?.passRate == null ? {} : { unit: '%' })}
        footer={deltaFooter(find('passRate'))}
        spark={spark(trend, 'passRate', 'Pass rate by day', 'text-chart-line')}
      />
      <Kpi
        data-testid="kpi-runs"
        label="Runs · all projects"
        value={current === null ? '—' : String(current.runs)}
        footer={deltaFooter(find('runs'))}
        spark={spark(trend, 'runs', 'Runs by day', 'text-chart-1')}
      />
      <Kpi
        data-testid="kpi-duration"
        label="Avg duration · all projects"
        value={orDash(current?.avgDurationMs ?? null, formatDuration)}
        footer={deltaFooter(find('avgDurationMs'))}
        spark={spark(trend, 'avgDurationMs', 'Average duration by day', 'text-chart-2')}
      />
      <Kpi
        data-testid="kpi-flaky"
        label="Flaky tests · all projects"
        value={current === null ? '—' : String(current.flakyTests)}
        footer={deltaFooter(find('flakyTests'))}
      />
      <Kpi
        data-testid="kpi-maturity"
        label="QA maturity"
        value={scan === null ? '—' : String(scan.maturity)}
        unit="%"
        footer={
          scan === null
            ? 'repository unscanned'
            : `${String(covered)} of ${String(counted.length)} capabilities`
        }
      />
    </section>
  );
}

function BeforeNow({
  comparisons,
  trend,
}: {
  comparisons: Comparison[];
  trend: AnalyticsTrend | null;
}): React.ReactElement {
  const { better, worse } = tally(comparisons);
  return (
    <Panel title="Before vs now" data-testid="dashboard-before-now">
      {trend === null ? (
        <Quiet>Waiting for run history…</Quiet>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-fg-muted">
                <th scope="col" className="pb-2 text-left font-normal">
                  Metric
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Before
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Now
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((entry) => (
                <tr
                  key={entry.key}
                  data-testid={`compare-${entry.key}`}
                  className="border-t border-border"
                >
                  <th scope="row" className="py-0.5 text-left font-normal">
                    {entry.label}
                  </th>
                  <td className="py-0.5 text-right tabular-nums text-fg-muted">
                    {orDash(entry.before, entry.format)}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">
                    {orDash(entry.now, entry.format)}
                  </td>
                  <td className="py-0.5 text-right">
                    <Delta
                      text={formatDelta(entry)}
                      verdict={entry.verdict}
                      rising={entry.delta === null || entry.delta === 0 ? null : entry.delta > 0}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p
            data-testid="before-now-tally"
            className="mt-auto max-w-measure pt-2 text-xs text-fg-muted [@media(max-height:820px)]:hidden"
          >
            {better} improved · {worse} regressed, against the {trend.days} days before
          </p>
        </>
      )}
    </Panel>
  );
}

const CELL_TONE = {
  good: 'bg-success text-on-fill',
  warn: 'bg-warning text-on-fill',
  bad: 'bg-danger text-on-fill',
} as const;

/**
 * The 5×3 health matrix, one tile per cell.
 *
 * **A cell nobody measured gets no colour.** `surfaceCoverage` is `null` when no coverage
 * artifact was ingested, and colouring that tile would draw a confident verdict on a
 * dimension nobody measured. It is drawn as a dashed outline and says `unmeasured`.
 */
function Matrix({ score }: { score: QaScore | null }): React.ReactElement {
  return (
    <Panel title="Health matrix" data-testid="dashboard-matrix">
      {score === null ? (
        <Quiet>The score could not be read.</Quiet>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-[5.5rem_repeat(3,minmax(0,1fr))] gap-1 text-xs">
            <span />
            {SCORE_SURFACES.map((surface) => (
              <span key={surface} className="truncate text-center text-fg-muted">
                {surface}
              </span>
            ))}
            {SCORE_CATEGORIES.map((category) => (
              <React.Fragment key={category}>
                <span className="self-center truncate text-fg-muted">{category}</span>
                {SCORE_SURFACES.map((surface) => (
                  <MatrixCell
                    key={surface}
                    cell={score.cells.find(
                      (candidate) =>
                        candidate.category === category && candidate.surface === surface,
                    )}
                  />
                ))}
              </React.Fragment>
            ))}
          </div>
          <p
            data-testid="matrix-limiter"
            className="mt-2 max-w-measure truncate text-xs text-fg-muted"
          >
            Blocking: <span className="font-mono text-fg">{score.cappedBy}</span> at{' '}
            <span className="tabular-nums">{score.cappingValue.toFixed(2)}</span> — closing it moves
            the total most.
          </p>
        </>
      )}
    </Panel>
  );
}

function MatrixCell({ cell }: { cell: ScoreCell | undefined }): React.ReactElement {
  if (cell === undefined || cell.excluded) {
    return (
      <span className="flex items-center justify-center rounded-md bg-surface-muted text-fg-muted">
        n/a
      </span>
    );
  }
  const unmeasured = cell.inputs.surfaceCoverage === null;
  const tone = band(cell.score);
  return (
    <span
      data-testid={`cell-${cell.key}`}
      data-band={unmeasured ? 'unmeasured' : tone}
      className={cn(
        'flex items-center justify-center rounded-md tabular-nums',
        unmeasured ? 'border border-dashed border-fg-muted text-fg-muted' : CELL_TONE[tone],
      )}
    >
      {cell.score.toFixed(2)}
      <span className="sr-only">{`, ${cell.key}, ${unmeasured ? 'coverage unmeasured' : tone}`}</span>
    </span>
  );
}

const LINK =
  '-my-3 inline-flex min-h-11 items-center rounded-sm px-1 text-xs text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Gaps ranked by what closing them is worth, then the tools the repository is missing.
 *
 * Both are here because both name a closure: a gap carries `cheapestClosure`, and a
 * missing capability carries the tool that would cover it. A list of low numbers with no
 * action is not a queue.
 */
function NextActions({
  gaps,
  scan,
  projectId,
}: {
  gaps: QaGapsResponse | null;
  scan: RepoScan | null;
  projectId: string;
}): React.ReactElement {
  const [room, listRef] = useFitCount(52, 5);
  const tools = (scan?.toolbox ?? [])
    .filter((entry) => entry.status === 'recommended')
    .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]);
  // As many actions as the panel has room for, at most five; one slot is kept for a missing
  // tool when there is one, because a gap list alone never says what to install.
  const total = Math.min(5, room);
  const missing = tools.slice(0, tools.length === 0 ? 0 : total >= 5 ? 2 : 1);
  const ranked = (gaps?.gaps ?? [])
    .slice()
    .sort((left, right) => right.potential - left.potential || left.cell.localeCompare(right.cell))
    .slice(0, Math.max(0, total - missing.length));
  return (
    <Panel
      title="Next best actions"
      data-testid="dashboard-queue"
      action={
        <Link to="/dashboard/toolbox" className={LINK}>
          Toolbox
        </Link>
      }
    >
      {ranked.length === 0 && missing.length === 0 ? (
        <Quiet>Nothing queued: no cell is below target and no capability is missing.</Quiet>
      ) : (
        <div ref={listRef} className="min-h-0 flex-1 overflow-hidden">
          <ul className="-mx-2 space-y-0.5">
            {ranked.map((gap) => (
              <li key={gap.cell} data-testid={`queue-gap-${gap.cell}`} className="min-w-0">
                <Link
                  to="/dashboard/gaps/$projectId"
                  params={{ projectId }}
                  title={gap.cheapestClosure}
                  className="block min-w-0 rounded-lg px-2 py-1.5 no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-sm">{gap.cell}</span>
                    <span className="shrink-0 tabular-nums text-xs text-success">
                      +{(gap.potential * 100).toFixed(0)} pts
                    </span>
                  </div>
                  <p className="max-w-measure truncate text-xs text-fg-muted">
                    {gap.cheapestClosure}
                  </p>
                </Link>
              </li>
            ))}
            {missing.map((entry) => (
              <li key={entry.id} data-testid={`queue-tool-${entry.id}`} className="min-w-0">
                <Link
                  to="/dashboard/toolbox"
                  title={entry.reason}
                  className="block min-w-0 rounded-lg px-2 py-1.5 no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm">Add {entry.name}</span>
                    <span className="shrink-0 text-xs uppercase text-warning">
                      {entry.priority}
                    </span>
                  </div>
                  <p className="max-w-measure truncate text-xs text-fg-muted">{entry.reason}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/**
 * The mean coverage, the test totals, and the findings, across every report found.
 *
 * **The mean, not the best.** A monorepo with one package at 98% and four at 70% is not a
 * 98% repository, and the maximum is the number that would flatter it most.
 */
export function summariseReports(reports: readonly RepoReport[]): {
  coverage: number | null;
  coverageReports: number;
  tests: number;
  failing: number;
  findings: number;
} {
  // A coverage report with no `lines` figure measured nothing: it is left out of the mean,
  // not averaged in as 0%.
  const coverage = reports
    .filter((report) => report.kind === 'coverage')
    .map((report) => report.metrics['lines'])
    .filter((value): value is number => typeof value === 'number');
  const sum = (kind: RepoReport['kind'], key: string) =>
    reports
      .filter((report) => report.kind === kind)
      .reduce((total, report) => total + (report.metrics[key] ?? 0), 0);
  return {
    coverage:
      coverage.length === 0
        ? null
        : coverage.reduce((total, value) => total + value, 0) / coverage.length,
    coverageReports: coverage.length,
    tests: sum('tests', 'passed') + sum('tests', 'failed'),
    failing: sum('tests', 'failed'),
    findings: sum('security', 'findings') + sum('lint', 'errors'),
  };
}

function Reports({ scan }: { scan: RepoScan | null }): React.ReactElement {
  const reports = scan?.reports ?? [];
  const summary = summariseReports(reports);
  // As many report lines as the panel has room for.
  const [shown, listRef] = useFitCount(24, 3);
  return (
    <Panel
      title="Reports on disk"
      data-testid="dashboard-reports"
      action={
        <Link to="/dashboard/health" className={LINK}>
          Health
        </Link>
      }
    >
      {scan === null ? (
        <Quiet>The repository could not be scanned.</Quiet>
      ) : (
        <>
          <dl className="grid shrink-0 grid-cols-3 gap-2">
            <Mini
              label="Coverage"
              value={orDash(summary.coverage, formatPercent)}
              hint={
                summary.coverageReports > 1
                  ? `mean of ${String(summary.coverageReports)}`
                  : undefined
              }
            />
            <Mini
              label="Tests"
              value={String(summary.tests)}
              hint={summary.failing > 0 ? `${String(summary.failing)} failing` : undefined}
              hintTone="text-danger"
            />
            <Mini label="Findings" value={String(summary.findings)} />
          </dl>
          <div ref={listRef} className="mt-3 min-h-0 flex-1 overflow-hidden">
            <ul className="space-y-1.5">
              {reports.slice(0, shown).map((report) => (
                <li
                  key={report.path}
                  className="flex min-w-0 items-center gap-2 text-xs"
                  title={report.path}
                >
                  <StatusDot status={report.status} />
                  <span className="truncate">{report.headline}</span>
                </li>
              ))}
              {reports.length === 0 ? (
                <li className="text-xs text-fg-muted">
                  No coverage, test, lint or security report was found in the repository.
                </li>
              ) : null}
            </ul>
          </div>
        </>
      )}
    </Panel>
  );
}

function Mini({
  label,
  value,
  hint,
  hintTone = 'text-fg-muted',
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: string;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-fg-muted">{label}</dt>
      <dd className="m-0 tabular-nums text-2xl font-semibold">{value}</dd>
      {hint === undefined ? null : <dd className={cn('m-0 text-xs', hintTone)}>{hint}</dd>}
    </div>
  );
}
