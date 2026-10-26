import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Button, Flame, GitBranch, Sparkline, Timer, cn } from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import {
  Kpi,
  PageFrame,
  PageHeader,
  Panel,
  Quiet,
  Segmented,
  useFitCount,
} from '../../components/kit.js';
import { FailureHeatmap } from '../../components/charts/FailureHeatmap.js';
import { HistoryChart } from '../../components/charts/HistoryChart.js';
import {
  FailureClustersPanel,
  QuarantineSuggestionsPanel,
} from '../../components/InsightsCauses.js';
import { ProjectGate } from '../../components/ProjectGate.js';
import { headline } from '../../components/Readiness.js';
import { Responsive } from '../../components/responsive.js';
import { useResource } from '../../hooks/useResource.js';
import { defaultApiClient, type ApiClient } from '../../lib/api.js';
import { formatDuration, orDash, shortDate } from '../../lib/insights.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import { testHistoryPath } from '../../route-manifest.js';
import type {
  FlakyTest,
  ProjectHistory,
  QaInsights,
  RegisteredProject,
  ReleaseReadinessCard,
  SlowTest,
} from '../../lib/qa.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/insights',
  component: () => <InsightsPage qa={createQaClient()} api={defaultApiClient} />,
});

/**
 * Insights: the questions a QA lead asks every week, answered from the run history.
 *
 * Which tests flip, which are getting slower, where failures cluster, how long a red suite
 * stays red, which branch is unhealthy, and whether coverage and health are moving. Every
 * panel is computed by the API from stored evidence (`GET /dashboard/insights`, `/history`,
 * `/readiness`), and every empty panel says *why* it is empty rather than drawing a zero.
 */
const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;
type WindowValue = (typeof WINDOWS)[number]['value'];

export function InsightsPage({ qa, api }: { qa: QaClient; api: ApiClient }): React.ReactElement {
  return (
    <ProjectGate qa={qa} title="Insights">
      {(project, switcher) => (
        <InsightsBody qa={qa} api={api} project={project} switcher={switcher} />
      )}
    </ProjectGate>
  );
}

const VERDICT_WORD = { go: 'Go', caution: 'Caution', 'no-go': 'No-go' } as const;
const VERDICT_TONE = {
  go: 'text-success',
  caution: 'text-warning',
  'no-go': 'text-danger',
} as const;

function InsightsBody({
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
  const insights = useResource<QaInsights>(
    () => qa.getInsights(Number(days), project.id),
    [qa, days, project.id],
  );
  const history = useResource<ProjectHistory>(
    () => qa.getHistory(project.id, Math.max(30, Number(days))),
    [qa, days, project.id],
  );
  const readiness = useResource<ReleaseReadinessCard>(
    () => qa.getReadiness(project.id, 7),
    [qa, project.id],
  );
  return (
    <PageFrame data-testid="insights-page">
      <PageHeader
        title="Insights"
        subtitle={
          insights.status === 'ready'
            ? `${String(insights.value.runs)} runs in ${project.name} over the last ${days} days`
            : project.name
        }
        actions={
          <>
            {switcher}
            <Segmented label="Window" options={WINDOWS} value={days} onChange={setDays} />
          </>
        }
      />
      {insights.status === 'ready' ? (
        <InsightsGrid
          api={api}
          insights={insights.value}
          history={history.status === 'ready' ? history.value : null}
          historyFailure={history.status === 'error' ? history.message : null}
          readiness={readiness.status === 'ready' ? readiness.value : null}
        />
      ) : insights.status === 'error' ? (
        <Quiet role="alert" data-testid="insights-error">
          Could not read the insights: {insights.message}
        </Quiet>
      ) : (
        <Quiet data-testid="insights-loading">Reading {project.name}’s run history…</Quiet>
      )}
    </PageFrame>
  );
}

function InsightsGrid({
  api,
  insights,
  history,
  historyFailure,
  readiness,
}: {
  api: ApiClient;
  insights: QaInsights;
  history: ProjectHistory | null;
  historyFailure: string | null;
  readiness: ReleaseReadinessCard | null;
}): React.ReactElement {
  const flaky = <FlakyPanel tests={insights.flakyLeaderboard} api={api} />;
  const heatmap = (
    <Panel title="Failures by suite and day" data-testid="insights-heatmap" className="flex-1">
      {insights.failureHeatmap.length === 0 ? (
        <Quiet>No runs in this window.</Quiet>
      ) : (
        <FailureHeatmap rows={insights.failureHeatmap} dates={insights.dates} />
      )}
    </Panel>
  );
  const slow = <SlowPanel tests={insights.slowestTests} />;
  const recovery = <RecoveryPanel insights={insights} />;
  const trends = (
    <Panel title="Coverage and health over time" data-testid="insights-history" className="flex-1">
      <HistoryBody history={history} failure={historyFailure} />
    </Panel>
  );
  const causes = <FailureClustersPanel clusters={insights.failureClusters} api={api} />;
  const suggestions = (
    <QuarantineSuggestionsPanel suggestions={insights.quarantineSuggestions} api={api} />
  );
  return (
    <>
      <InsightKpis insights={insights} readiness={readiness} />
      <Responsive
        label="Insight sections"
        desktop={
          <>
            <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3">
              {flaky}
              <div className="col-span-2 flex min-h-0 flex-col">{heatmap}</div>
              {slow}
              {recovery}
              {trends}
            </div>
            <div className="grid h-72 shrink-0 grid-cols-2 gap-3">
              {causes}
              {suggestions}
            </div>
          </>
        }
        panels={[
          { id: 'flaky', label: 'Flaky', node: flaky },
          { id: 'heatmap', label: 'Failures', node: heatmap },
          { id: 'causes', label: 'Causes', node: causes },
          { id: 'suggestions', label: 'Quarantine', node: suggestions },
          { id: 'slow', label: 'Slowest', node: slow },
          { id: 'recovery', label: 'Recovery', node: recovery },
          { id: 'history', label: 'History', node: trends },
        ]}
      />
    </>
  );
}

/** A score bar: the share of a test's runs that disagreed with the one before. */
function ScoreBar({ score }: { score: number }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
    >
      <span
        className="block h-full rounded-full bg-chart-flaky"
        style={{ width: `${String(Math.max(4, Math.round(score * 100)))}%` }}
      />
    </span>
  );
}

function FlakyPanel({
  tests,
  api,
}: {
  tests: readonly FlakyTest[];
  api: ApiClient;
}): React.ReactElement {
  const [shown, listRef] = useFitCount(60, 6);
  const [quarantined, setQuarantined] = React.useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = React.useState<string | null>(null);
  const quarantine = async (test: FlakyTest) => {
    setFailure(null);
    try {
      await api.addQuarantine({
        testTitle: test.title,
        testFile: test.file ?? '(unknown file)',
        stableId: test.key,
        reason: `Flaky in Insights: ${String(test.flips)} flips, ${String(test.flaky)} retries over ${String(test.runs)} runs`,
      });
      setQuarantined((current) => new Set([...current, test.key]));
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <Panel
      title="Flaky leaderboard"
      data-testid="insights-flaky"
      className="flex-1"
      action={<Flame size={14} aria-hidden="true" className="text-chart-flaky" />}
    >
      {failure === null ? null : (
        <p role="alert" className="mb-2 shrink-0 truncate text-xs text-danger" title={failure}>
          {failure}
        </p>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-hidden">
        {tests.length === 0 ? (
          <Quiet>No test flipped between passing and failing in this window.</Quiet>
        ) : (
          <ol className="space-y-1">
            {tests.slice(0, shown).map((test, index) => (
              <li
                key={test.key}
                data-testid={`flaky-${String(index)}`}
                className="flex items-center gap-2"
              >
                <span className="w-5 shrink-0 text-right tabular-nums text-xs text-fg-muted">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={testHistoryPath(test.key)}
                    className="block truncate text-sm text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    title={test.key}
                  >
                    {test.title}
                  </a>
                  <div className="flex items-center gap-2">
                    <ScoreBar score={test.score} />
                    <span className="shrink-0 tabular-nums text-xs text-fg-muted">
                      {`${String(Math.round(test.score * 100))}% · ${String(test.flips)} flips · ${String(test.flaky)} retried`}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={quarantined.has(test.key)}
                  onClick={() => void quarantine(test)}
                  aria-label={
                    quarantined.has(test.key)
                      ? `${test.title} is quarantined`
                      : `Quarantine ${test.title}`
                  }
                  className="min-h-11 shrink-0"
                >
                  {quarantined.has(test.key) ? 'Quarantined' : 'Quarantine'}
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function SlowPanel({ tests }: { tests: readonly SlowTest[] }): React.ReactElement {
  const [shown, listRef] = useFitCount(52, 6);
  return (
    <Panel
      title="Slowest tests"
      data-testid="insights-slow"
      className="flex-1"
      action={<Timer size={14} aria-hidden="true" className="text-chart-2" />}
    >
      <div ref={listRef} className="min-h-0 flex-1 overflow-hidden">
        {tests.length === 0 ? (
          <Quiet>No test reported a duration in this window.</Quiet>
        ) : (
          <ul className="divide-y divide-border">
            {tests.slice(0, shown).map((test) => {
              const series = test.daily.filter((value): value is number => value !== null);
              return (
                <li
                  key={test.key}
                  data-testid="slow-test"
                  className="flex min-h-12 items-center gap-3 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" title={test.key}>
                      {test.title}
                    </div>
                    <div className="tabular-nums text-xs text-fg-muted">
                      {`p50 ${formatDuration(test.p50Ms)} · p95 ${formatDuration(test.p95Ms)}`}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 tabular-nums text-xs',
                      test.changePct === null
                        ? 'text-fg-muted'
                        : test.changePct > 0
                          ? 'text-danger'
                          : 'text-success',
                    )}
                  >
                    {test.changePct === null
                      ? 'new'
                      : `${test.changePct > 0 ? '+' : '−'}${String(Math.abs(Math.round(test.changePct)))}%`}
                  </span>
                  {series.length < 2 ? null : (
                    <Sparkline
                      className="hidden shrink-0 sm:inline-flex"
                      points={series}
                      label={`${test.title}, median duration by day`}
                      tone="text-chart-2"
                    />
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

function RecoveryPanel({ insights }: { insights: QaInsights }): React.ReactElement {
  const { overall, suites } = insights.mttr;
  // As many branches as the space left fits: a busy repository has dozens.
  const [branchCount, branchRef] = useFitCount(34, 4);
  return (
    <Panel
      title="Recovery and branches"
      data-testid="insights-recovery"
      className="flex-1"
      action={<GitBranch size={14} aria-hidden="true" className="text-chart-1" />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <dl className="m-0 grid shrink-0 grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-fg-muted">Median</dt>
            <dd className="m-0 tabular-nums text-lg font-semibold">
              {orDash(overall.medianMs, formatDuration)}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">p90</dt>
            <dd className="m-0 tabular-nums text-lg font-semibold">
              {orDash(overall.p90Ms, formatDuration)}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Open</dt>
            <dd className="m-0 tabular-nums text-lg font-semibold">
              {String(suites.filter((suite) => suite.openSince !== null).length)}
            </dd>
          </div>
        </dl>
        <ul className="shrink-0 space-y-1 text-xs" aria-label="Suites still failing">
          {suites
            .filter((suite) => suite.openSince !== null)
            .slice(0, 2)
            .map((suite) => (
              <li key={suite.suite} className="flex items-center gap-2 text-danger">
                <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden="true" />
                <span className="truncate font-mono" title={suite.suite}>
                  {suite.suite}
                </span>
                <span className="ml-auto shrink-0">
                  red since {shortDate((suite.openSince ?? '').slice(0, 10))}
                </span>
              </li>
            ))}
        </ul>
        <ul
          ref={branchRef}
          className="min-h-0 flex-1 space-y-1.5 overflow-hidden"
          aria-label="Pass rate by branch"
        >
          {insights.passRateByBranch.length === 0 ? (
            <li>
              <Quiet>No runs in this window.</Quiet>
            </li>
          ) : (
            insights.passRateByBranch.slice(0, branchCount).map((branch) => (
              <li key={branch.branch} data-testid="branch-row" className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono" title={branch.branch}>
                    {branch.branch}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {orDash(branch.passRate, (value) => `${value.toFixed(1)}%`)} · {branch.runs}{' '}
                    runs
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1 block h-1.5 overflow-hidden rounded-full',
                    branch.passRate === null ? 'bg-surface-muted' : 'bg-chart-fail/30',
                  )}
                >
                  {branch.passRate === null ? null : (
                    <span
                      className="block h-full rounded-full bg-chart-pass"
                      style={{ width: `${String(branch.passRate)}%` }}
                    />
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </Panel>
  );
}

function InsightKpis({
  insights,
  readiness,
}: {
  insights: QaInsights;
  readiness: ReleaseReadinessCard | null;
}): React.ReactElement {
  const { overall } = insights.mttr;
  const slowest = insights.slowestTests[0];
  return (
    <section
      aria-label="Key insights"
      className="grid shrink-0 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4"
    >
      <Kpi
        hero
        data-testid="insight-readiness"
        label="Release readiness"
        value={readiness === null ? '—' : VERDICT_WORD[readiness.verdict]}
        tone={readiness === null ? undefined : VERDICT_TONE[readiness.verdict]}
        footer={readiness === null ? 'unread' : headline(readiness)}
      />
      <Kpi
        data-testid="insight-flaky"
        label="Flaky tests"
        value={String(insights.flakyLeaderboard.length)}
        tone={insights.flakyLeaderboard.length > 0 ? 'text-warning' : undefined}
        footer={
          insights.flakyLeaderboard[0] === undefined
            ? 'nothing flipped in this window'
            : `worst: ${insights.flakyLeaderboard[0].title}`
        }
      />
      <Kpi
        data-testid="insight-mttr"
        label="Median time to recover"
        value={orDash(overall.medianMs, formatDuration)}
        footer={
          overall.openSince === null
            ? `${String(overall.recoveries)} recover${overall.recoveries === 1 ? 'y' : 'ies'}`
            : `red since ${shortDate(overall.openSince.slice(0, 10))}`
        }
        tone={overall.openSince === null ? undefined : 'text-danger'}
      />
      <Kpi
        data-testid="insight-slowest"
        label="Slowest test, p95"
        value={slowest === undefined ? '—' : formatDuration(slowest.p95Ms)}
        footer={slowest === undefined ? 'no durations reported' : slowest.title}
      />
    </section>
  );
}

function HistoryBody({
  history,
  failure,
}: {
  history: ProjectHistory | null;
  failure: string | null;
}): React.ReactElement {
  if (history === null) return <Quiet>{failure ?? 'Reading the history…'}</Quiet>;
  if (history.points.length >= 2) return <HistoryChart points={history.points} />;
  return (
    <Quiet data-testid="history-collecting">
      {history.collectingSince === null
        ? 'No readings yet: one is taken each time the repository is scanned, at most hourly.'
        : `Collecting since ${shortDate(history.collectingSince.slice(0, 10))}: a line needs two readings.`}
    </Quiet>
  );
}
