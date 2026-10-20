import React from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '@automate/ui';
import { SCORE_CATEGORIES, SCORE_SURFACES, type ScoreCell } from '@automate/shared-contracts';
import { useResource } from '../hooks/useResource.js';
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
  QaScore,
  RegisteredProject,
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
import { TrendChart } from './TrendChart.js';

/**
 * The dashboard: the whole QA picture of one repository, on one screen, with no scroll.
 *
 * ## Read in three passes
 *
 * 1. **The six figures** — health, pass rate, volume, speed, flakiness, maturity — each
 *    with the change since the window before it, so every number is an answer and not a
 *    reading.
 * 2. **The trend and the comparison** — the same window drawn day by day, and "before
 *    versus now" as a table whose every row says whether the change was good.
 * 3. **What to do** — the health matrix with its limiter, the next actions ranked by
 *    what they are worth, and what the reports already on disk say.
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
    <ProjectGate qa={qa} title="Dashboard" projectId={projectId}>
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

  return (
    <PageFrame data-testid="dashboard">
      <PageHeader
        title="Dashboard"
        subtitle={
          <span data-testid="dashboard-subject">
            {project.name} · {project.repoPath ?? 'no repository path recorded'}
          </span>
        }
        actions={
          <>
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
  return (
    <>
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
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-3 xl:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel
          title={
            trend === null
              ? 'Pass rate and volume'
              : `Pass rate and volume · last ${String(trend.days)} days`
          }
          className="min-h-72 xl:col-span-2 xl:min-h-0"
          data-testid="dashboard-trend"
        >
          {trend === null ? (
            <Quiet>{trendFailure ?? 'Reading run history…'}</Quiet>
          ) : (
            <TrendChart buckets={trend.buckets} data-testid="trend-chart" />
          )}
        </Panel>
        <BeforeNow comparisons={comparisons} trend={trend} />
        <Matrix score={snapshot.score.value} />
        <NextActions gaps={snapshot.gaps.value} scan={snapshot.scan.value} projectId={projectId} />
        <Reports scan={snapshot.scan.value} />
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
  const covered = scan?.capabilities.filter((entry) => entry.covered).length ?? 0;
  return (
    <section
      aria-label="Key figures"
      className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
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
        label="Pass rate"
        value={orDash(current?.passRate ?? null, (value) => value.toFixed(1))}
        unit="%"
        footer={deltaFooter(find('passRate'))}
      />
      <Kpi
        data-testid="kpi-runs"
        label="Runs"
        value={current === null ? '—' : String(current.runs)}
        footer={deltaFooter(find('runs'))}
      />
      <Kpi
        data-testid="kpi-duration"
        label="Avg duration"
        value={orDash(current?.avgDurationMs ?? null, formatDuration)}
        footer={deltaFooter(find('avgDurationMs'))}
      />
      <Kpi
        data-testid="kpi-flaky"
        label="Flaky tests"
        value={current === null ? '—' : String(current.flakyTests)}
        footer={
          snapshot.quarantine.value === null
            ? deltaFooter(find('flakyTests'))
            : `${String(snapshot.quarantine.value.length)} quarantined`
        }
      />
      <Kpi
        data-testid="kpi-maturity"
        label="QA maturity"
        value={scan === null ? '—' : String(scan.maturity)}
        unit="%"
        footer={
          scan === null
            ? 'repository unscanned'
            : `${String(covered)} of ${String(scan.capabilities.length)} capabilities`
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
  '-my-3 inline-flex min-h-11 items-center rounded-sm px-1 text-xs text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

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
  const listRef = React.useRef<HTMLDivElement>(null);
  const room = useFitCount(listRef, 52, 5);
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
        <div ref={listRef} className="xl:min-h-0 xl:flex-1 xl:overflow-hidden">
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
  const coverage = reports
    .filter((report) => report.kind === 'coverage')
    .map((report) => report.metrics['lines'] ?? 0);
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
  const listRef = React.useRef<HTMLDivElement>(null);
  // As many report lines as the panel has room for, on a big screen; three otherwise.
  const shown = useFitCount(listRef, 24, 3);
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
          <div ref={listRef} className="mt-3 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
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
      <dd className="m-0 tabular-nums text-2xl font-light">{value}</dd>
      {hint === undefined ? null : <dd className={cn('m-0 text-xs', hintTone)}>{hint}</dd>}
    </div>
  );
}
