import React from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Meter,
  Sparkline,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Button,
  Alert,
  AlertDescription,
  AlertTitle,
  DefinitionList,
  DefinitionListDetail,
  DefinitionListTerm,
} from '@automate/ui';
import {
  PYRAMID_ROW,
  SCORE_CATEGORIES,
  SCORE_SURFACES,
  type ScoreCell,
} from '@automate/shared-contracts';
import type { QaClient } from '../lib/qa-client';
import type { QaFlakyResponse, QaGapsResponse, QaScore, RegisteredProject } from '../lib/qa';
import type { ApiClient, QuarantineEntry } from '../lib/api';
import { useResource } from '../hooks/useResource';
import { QA_TOOLS_REGISTRY, type QATool } from '@automate/projects/tool-catalog';
import { deriveFindings, type Finding, type FindingsSnapshot, type Reading } from '../lib/findings';
import {
  analyzeStack,
  CATEGORY_LABELS,
  ESSENTIAL_TOOL_IDS,
  groupByCategory,
  TIER_LABELS,
  TIER_VARIANT,
  type ToolDetection,
  type ToolStatus,
} from '../lib/analysis';
/**
 * The MAIN dashboard: one screen, the whole QA picture.
 *
 * ## The flow it implements
 *
 * The product promise, top to bottom:
 *
 * 1. **Install.** Point the API at a folder. The registry answers.
 * 2. **Read.** The system has already read every report in the repo —
 * the score, the gaps, the flaky cells, the hollow cells, the
 * structural findings, the quarantine list, the analytics summary.
 * 3. **Reason.** Seven reads settle into one snapshot, and the insight
 * engine derives a verdict from them.
 * 4. **Present.** KPIs at the top, the limiter below them, the matrix
 * beside the verdict, the quarantine suggestions under that, and the
 * QA stack — every tool, split by tier — at the bottom.
 *
 * ## Why one screen
 *
 * A QA engineer's first question is "what is blocking me", and the
 * second is "what do I have". Those used to be three routes. A reader
 * who had to navigate to see the whole picture was reading a product in
 * pieces; this is the product whole.
 *
 * ## The reads, and why they are seven
 *
 * `analytics/summary`, `qa/score`, `qa/flaky`, `qa/gaps`,
 * `dashboard/quarantine`, `qa/hollow` and `qa/structure`. There is no
 * aggregate endpoint, and there is deliberately not one: an aggregate
 * would be a second authority over numbers that already have seven
 * endpoints, and it would be the first thing to drift. Each read
 * settles independently, so one dead endpoint names itself and the
 * other six still render.
 */ const READS: readonly (keyof FindingsSnapshot)[] = [
  'analytics',
  'score',
  'flaky',
  'gaps',
  'quarantine',
  'hollow',
  'structure',
];
/** Which endpoint failed, and what it said. */ const ENDPOINT_NAMES: Record<
  keyof FindingsSnapshot,
  string
> = {
  analytics: 'dashboard/analytics/summary',
  score: 'qa/score',
  flaky: 'qa/flaky',
  gaps: 'qa/gaps',
  quarantine: 'dashboard/quarantine',
  hollow: 'qa/hollow',
  structure: 'qa/structure',
};
/** The band a score cell falls into. */ function band(value: number): {
  label: string;
  className: string;
} {
  if (value >= 0.6) return { label: 'healthy', className: 'text-success' };
  if (value >= 0.3) return { label: 'thin', className: 'text-warning' };
  return { label: 'failing', className: 'text-danger' };
}
/**
 * The score's own trend, as a series the sparkline can draw.
 *
 * **The API computed this; the client no longer synthesises it.** The old
 * `seriesFromScore` built a twelve-point series from the *cells* — the cell
 * spread is a shape at one instant, not a history, and labelling it a trend
 * taught the reader to ignore the chart. A real series is `score.trend`, and a
 * score with no earlier window (empty points) draws nothing rather than
 * something invented.
 */
function trendSeries(score: QaScore | null): { points: number[]; labels: string[] } {
  if (score === null || score.trend.points.length < 2) return { points: [], labels: [] };
  return { points: [...score.trend.points], labels: [...score.trend.labels] };
}
export function Main({
  qa,
  api,
  projectId,
}: {
  qa: QaClient;
  api: ApiClient;
  /** Which project to report on. Defaults to the first registered one. */ projectId?: string;
}): React.ReactElement {
  const registry = useResource<RegisteredProject[]>(() => qa.listProjects(), [qa]);
  if (registry.status === 'loading') {
    return (
      <div data-testid="main-loading" className="text-sm text-fg-muted">
        {' '}
        Reading the registry…{' '}
      </div>
    );
  }
  if (registry.status === 'error') {
    return (
      <EmptyState
        data-testid="main-registry-error"
        title="The project registry is unavailable"
        description={registry.message}
      />
    );
  }
  const projects = registry.value;
  const subject = projectId === undefined ? projects[0] : projects.find((p) => p.id === projectId); // **Onboarding is a screen, not an empty grid.** An empty table cannot
  // distinguish "no project yet" from "the API is broken", and those need
  // opposite responses.
  if (subject === undefined) {
    return <Onboarding />;
  }
  return <MainBody qa={qa} api={api} subject={subject} />;
}
function MainBody({
  qa,
  api,
  subject,
}: {
  qa: QaClient;
  api: ApiClient;
  subject: RegisteredProject;
}): React.ReactElement {
  const snapshot = useResource<FindingsSnapshot>(
    (signal) => loadSeven(api, qa, subject.id, signal),
    [api, qa, subject.id],
  );
  if (snapshot.status === 'loading') {
    return (
      <div data-testid="main-loading" className="text-sm text-fg-muted">
        {' '}
        Reading seven endpoints for {subject.name}…{' '}
      </div>
    );
  }
  if (snapshot.status === 'error') {
    return (
      <EmptyState
        data-testid="main-load-error"
        title="Could not read the dashboard"
        description={snapshot.message}
      />
    );
  }
  const value = snapshot.value;
  const failures = READS.filter((name) => value[name].failure !== null);
  const insights = deriveFindings(value);
  const trend = trendSeries(value.score.value);
  const critical = insights.filter((insight) => insight.severity === 'critical');
  const warnings = insights.filter((insight) => insight.severity === 'warning');
  const info = insights.filter((insight) => insight.severity === 'info');
  return (
    <div data-testid="main" className="space-y-6">
      {' '}
      <header>
        {' '}
        <h1 className="text-balance text-3xl font-bold tracking-tight">Automate</h1>{' '}
        <p
          data-testid="main-subject"
          className="mt-2 max-w-measure text-pretty text-sm text-fg-muted"
        >
          {' '}
          {subject.name} · {subject.repoPath ?? 'no repository path recorded'}{' '}
        </p>{' '}
      </header>{' '}
      {failures.length > 0 ? <FailureNotice snapshot={value} /> : null}{' '}
      {/* The limiter: what is blocking you, and why it is the number to read. */}{' '}
      <Limiter score={value.score.value} /> {/* The KPIs: what the seven reads say, at a glance. */}{' '}
      <StatRow snapshot={value} /> {/* The verdict: the insights, in order of what to do first. */}{' '}
      <div className="grid gap-4 xl:grid-cols-3">
        {' '}
        <VerdictCard
          insights={insights}
          critical={critical.length}
          warnings={warnings.length}
          info={info.length}
        />{' '}
        {value.score.value === null ? null : (
          <div className="space-y-4">
            {' '}
            <ScoreShapeCard score={value.score.value} trend={trend} />{' '}
            <PyramidStrip score={value.score.value} />{' '}
          </div>
        )}{' '}
      </div>{' '}
      {/* The matrix: five categories by three surfaces. */}{' '}
      {value.score.value === null ? null : <Matrix score={value.score.value} />}{' '}
      {/* The decision queue: gaps ranked by what closing them is worth, then flaky cells. */}{' '}
      <Queue gaps={value.gaps.value} flaky={value.flaky.value} />{' '}
      {/* The automated quarantine engine: flaky fingerprints, ranked, with a one-click suggestion. */}{' '}
      <QuarantineSuggestions quarantine={value.quarantine.value} flaky={value.flaky.value} />{' '}
      {/* The QA stack: every tool, split by tier, with what is missing. */} <QaStack />{' '}
    </div>
  );
}
/**
 * Seven reads, settled independently, in one round trip's worth of wall
 * clock.
 *
 * `Promise.allSettled` rather than `Promise.all`, because the whole
 * point of the failures list below is that one dead endpoint must not
 * empty the screen. **All seven, including hollow and structure.** Those
 * two used to carry a `.catch(() => null)`, which made a dead endpoint
 * settle as a fulfilled `null` — an answer of "no hollow cells" about a
 * read that never happened, indistinguishable from the real thing, and
 * absent from the failures notice. The engine reads `value` as an answer
 * and `failure` as an absence; the two must not blur.
 */ async function loadSeven(
  api: ApiClient,
  qa: QaClient,
  projectId: string,
  signal: AbortSignal,
): Promise<FindingsSnapshot> {
  const settled = await Promise.allSettled([
    api.getAnalyticsSummary({ signal }),
    qa.getScore(projectId),
    qa.getFlaky(projectId),
    qa.getGaps(projectId),
    api.getQuarantine({ signal }),
    qa.getHollow(projectId),
    qa.getStructure(projectId),
  ]);
  const [analytics, score, flaky, gaps, quarantine, hollow, structure] = settled;
  return {
    analytics: read(analytics),
    score: read(score),
    flaky: read(flaky),
    gaps: read(gaps),
    quarantine: read(quarantine),
    hollow: read(hollow),
    structure: read(structure),
  };
}
/** The endpoint's own sentence, not `error.message`. */ function read<T>(
  settled: PromiseSettledResult<T>,
): Reading<T> {
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
function FailureNotice({ snapshot }: { snapshot: FindingsSnapshot }): React.ReactElement {
  return (
    <div
      data-testid="main-failures"
      role="alert"
      className="rounded-md border border-warning p-4 text-sm"
    >
      {' '}
      <p className="font-semibold text-warning">
        {' '}
        {READS.filter((name) => snapshot[name].failure !== null).length} of seven reads failed{' '}
      </p>{' '}
      <ul className="mt-2 space-y-1 text-fg-muted">
        {' '}
        {READS.filter((name) => snapshot[name].failure !== null).map((name) => (
          <li key={name} data-testid={`main-failure-${name}`}>
            {' '}
            <span className="font-mono">{ENDPOINT_NAMES[name]}</span> —{' '}
            {snapshot[name].failure}{' '}
          </li>
        ))}{' '}
      </ul>{' '}
      <p className="mt-2 max-w-measure text-pretty text-fg-muted">
        {' '}
        Everything below is what the reads that answered. A missing row is a read that failed, not a
        measurement of zero.{' '}
      </p>{' '}
    </div>
  );
}
/** The KPI row: the numbers the seven reads produce, and nothing else. */ function StatRow({
  snapshot,
}: {
  snapshot: FindingsSnapshot;
}): React.ReactElement {
  const { analytics, score, gaps, quarantine } = snapshot;
  return (
    <section aria-label="Run and suite totals" className="space-y-2">
      {' '}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {' '}
        <StatCard
          data-testid="main-stat-pass"
          title="Pass rate"
          value={analytics.value === null ? 'unread' : `${analytics.value.passRate.toFixed(1)}%`}
        />{' '}
        <StatCard
          data-testid="main-stat-runs"
          title="Runs"
          value={analytics.value === null ? 'unread' : analytics.value.totalRuns}
        />{' '}
        <StatCard
          data-testid="main-stat-gaps"
          title="Gaps"
          value={gaps.value === null ? 'unread' : gaps.value.gaps.length}
        />{' '}
        <StatCard
          data-testid="main-stat-quarantine"
          title="Quarantine"
          value={quarantine.value === null ? 'unread' : quarantine.value.length}
        />{' '}
        <StatCard
          data-testid="main-stat-health"
          title="Health score"
          value={score.value === null ? 'unread' : score.value.total.toFixed(1)}
          description={score.value === null ? undefined : `as of ${score.value.at}`}
        />{' '}
      </div>{' '}
      <p className="text-xs text-fg-muted max-w-measure text-pretty">
        {' '}
        No delta is shown because no comparison instant has been chosen. A bare pass rate is a
        number, not an answer.{' '}
      </p>{' '}
    </section>
  );
}
/**
 * The headline: the term that limited the total, and why that is the
 * number to read.
 *
 * Reads `cappedBy` and `cappingValue` rather than re-deriving the
 * limiter. The server resolved it with the weights it actually used, and
 * a client that re-derived it would be a second implementation of the
 * mean — which is the one thing this product must not have.
 */ function Limiter({ score }: { score: QaScore | null }): React.ReactElement {
  if (score === null) {
    return (
      <Card data-testid="main-limiter">
        {' '}
        <CardHeader>
          {' '}
          <CardTitle>Blocking you</CardTitle>{' '}
          <CardDescription>
            {' '}
            The score could not be read, so nothing is claiming to know what is blocking you.{' '}
          </CardDescription>{' '}
        </CardHeader>{' '}
      </Card>
    );
  }
  const zeroed = score.cappingValue === 0;
  return (
    <Card data-testid="main-limiter" className="border-accent">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle className="tracking-widest text-fg-muted text-xs uppercase">
          {' '}
          Blocking you{' '}
        </CardTitle>{' '}
        <p className="mt-2 text-4xl font-bold">
          {' '}
          <span className="font-mono">{score.cappedBy}</span>{' '}
          <span className="ml-2 tabular-nums text-2xl font-semibold text-danger">
            {' '}
            {score.cappingValue.toFixed(2)}{' '}
          </span>{' '}
        </p>{' '}
        <p className="mt-3 max-w-measure text-pretty text-sm text-fg-muted">
          {' '}
          {zeroed
            ? 'One zero caps the geometric mean, so the total below is the other rows and one empty one. Closing this row moves the total more than anything else you could do.'
            : 'This row contributes the largest weighted shortfall to the geometric mean. Closing it moves the total more than any other row.'}{' '}
        </p>{' '}
      </CardHeader>{' '}
    </Card>
  );
}
/** The verdict: the insights, in order of what to do first. */ function VerdictCard({
  insights,
  critical,
  warnings,
  info,
}: {
  insights: readonly Finding[];
  critical: number;
  warnings: number;
  info: number;
}): React.ReactElement {
  return (
    <Card data-testid="main-verdict" className="xl:col-span-2">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle>The verdict</CardTitle>{' '}
        <CardDescription>
          {' '}
          What the seven reads say, in order of what to do first. {critical} critical, {warnings}{' '}
          warnings, {info} context.{' '}
        </CardDescription>{' '}
      </CardHeader>{' '}
      <CardContent>
        {' '}
        {insights.length === 0 ? (
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            {' '}
            Nothing to report: no zero caps the mean, no fingerprint is flipping, and no test is
            hollow. That is a suite worth trusting.{' '}
          </p>
        ) : (
          <ul className="space-y-3">
            {' '}
            {insights.map((insight) => (
              <li
                key={insight.id}
                data-testid={`main-insight-${insight.id}`}
                className="rounded-md border border-border-default p-4"
              >
                {' '}
                <div className="flex flex-wrap items-center gap-2">
                  {' '}
                  <Badge
                    variant={
                      insight.severity === 'critical'
                        ? 'danger'
                        : insight.severity === 'warning'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {' '}
                    {insight.severity}{' '}
                  </Badge>{' '}
                  <span className="font-semibold">{insight.title}</span>{' '}
                </div>{' '}
                <p className="mt-2 max-w-measure text-pretty text-sm">{insight.statement}</p>{' '}
                <p className="mt-1 font-mono text-xs text-fg-muted">
                  {insight.source} · {insight.citation}
                </p>{' '}
                <p className="mt-2 max-w-measure text-pretty text-sm text-fg-muted">
                  {' '}
                  <span className="font-medium text-fg">Do this: </span> {insight.action}{' '}
                </p>{' '}
              </li>
            ))}{' '}
          </ul>
        )}{' '}
      </CardContent>{' '}
    </Card>
  );
}
/** The score's own trend, drawn as a series, with the numbers beside it. */ function ScoreShapeCard({
  score,
  trend,
}: {
  score: QaScore | null;
  trend: { points: number[]; labels: string[] };
}): React.ReactElement {
  return (
    <Card data-testid="main-score-shape">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle>Score trend</CardTitle>{' '}
        <CardDescription>
          {' '}
          The total across the windows the API read. One point is a number, so a project with no
          earlier window draws nothing rather than a line.{' '}
        </CardDescription>{' '}
      </CardHeader>{' '}
      <CardContent>
        {' '}
        {trend.points.length > 1 ? (
          <Sparkline
            points={trend.points}
            label="Health score totals over the windows read"
            value={score === null ? undefined : `${score.total.toFixed(1)}`}
            trend={trend.points[trend.points.length - 1] >= trend.points[0] ? 'up' : 'down'}
            tone="text-accent"
          />
        ) : (
          <p className="max-w-measure text-sm text-fg-muted" data-testid="main-trend-unmeasured">
            No earlier window was read, so there is no direction to report.
          </p>
        )}{' '}
        <DefinitionList className="mt-4">
          {' '}
          <DefinitionListTerm>Cells scored</DefinitionListTerm>{' '}
          <DefinitionListDetail>{score?.cells.length ?? 0}</DefinitionListDetail>{' '}
          <DefinitionListTerm>Capped by</DefinitionListTerm>{' '}
          <DefinitionListDetail>{score?.cappedBy ?? '—'}</DefinitionListDetail>{' '}
          <DefinitionListTerm>Pyramid shape</DefinitionListTerm>{' '}
          <DefinitionListDetail>{score?.pyramid.shape.toFixed(2) ?? '—'}</DefinitionListDetail>{' '}
        </DefinitionList>{' '}
      </CardContent>{' '}
    </Card>
  );
}
/**
 * `pyramid-shape`, in its own strip and **not** as a sixteenth matrix cell.
 *
 * It answers "what shape is the suite", not "is the suite healthy" — which is why it
 * is not in `SCORE_CATEGORIES`: a project marking it `n/a` is a different statement
 * from a project having no performance tests, and folding it into the grid would
 * make the sixth answer look like the other five.
 *
 * The `declaredTarget` distinction is the one this has to get right: `null` means the
 * project chose no target, so the chart's default is nobody's decision and the strip
 * says so rather than reporting drift against it.
 */ function PyramidStrip({ score }: { score: QaScore }): React.ReactElement {
  const { pyramid } = score;
  const row = score.rows.find((candidate) => candidate.id === PYRAMID_ROW);
  return (
    <Card data-testid="main-pyramid">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle className="tracking-widest text-fg-muted text-xs uppercase">
          {' '}
          Suite shape — {PYRAMID_ROW}{' '}
        </CardTitle>{' '}
        <p className="mt-2 tabular-nums font-mono text-2xl font-bold">{pyramid.shape.toFixed(2)}</p>{' '}
        <p className="mt-1 max-w-measure tabular-nums text-pretty text-sm text-fg-muted">
          {' '}
          Observed {shares(pyramid.observed)} unit / integration / e2e.{' '}
          {pyramid.declaredTarget === null
            ? 'Target — none declared, so no drift is claimed.'
            : `Target ${shares(pyramid.declaredTarget)} against a drift of ${pyramid.drift.toFixed(2)}.`}{' '}
          {row === undefined ? '' : ` · weight ${row.weight.toFixed(2)}`}{' '}
          {row === undefined ? '' : ` · ${String(row.includedCells)} cells included`}{' '}
        </p>{' '}
      </CardHeader>{' '}
    </Card>
  );
}
/**
 * A share vector as percentages, and never as a raw float.
 *
 * `pyramid.observed` and `pyramid.target` are **shares of the executed tests**, not
 * counts: `PyramidTarget` is bounded `[0,1]` and `pyramidShape` divides by the total
 * before it compares. Printed raw, the strip said `Observed 0.8148148148148148 unit`
 * — sixteen digits of a fraction that reads as a count of tests. Rounding to whole
 * percent is also the precision the claim deserves: a share of 0.8148 is not a
 * measurement, it is three tests out of fifty-three.
 */ function shares(vector: { unit: number; integration: number; e2e: number }): string {
  return `${Math.round(vector.unit * 100)}% / ${String(Math.round(vector.integration * 100))}% / ${String(Math.round(vector.e2e * 100))}%`;
}
/**
 * The 5×3 grid, one `<rect>` per cell.
 *
 * **Inline SVG, and no chart library.** Fifteen cells and one sparkline do
 * not justify a 200 kB dependency and a second visual language; a heat cell is
 * a `<rect>` and a colour token.
 */ function Matrix({ score }: { score: QaScore }): React.ReactElement {
  return (
    <Card data-testid="main-matrix">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle>The matrix</CardTitle>{' '}
        <CardDescription>
          {' '}
          Five categories by three surfaces. Every cell carries its own inputs, so no number here is
          unexplained.{' '}
        </CardDescription>{' '}
      </CardHeader>{' '}
      <CardContent>
        {' '}
        <Table>
          {' '}
          <TableHeader>
            {' '}
            <TableRow>
              {' '}
              <TableHead>category</TableHead>{' '}
              {SCORE_SURFACES.map((surface) => (
                <TableHead key={surface} className="text-right">
                  {' '}
                  {surface}{' '}
                </TableHead>
              ))}{' '}
            </TableRow>{' '}
          </TableHeader>{' '}
          <TableBody>
            {' '}
            {SCORE_CATEGORIES.map((category) => (
              <TableRow key={category}>
                {' '}
                <TableCell className="font-medium">{category}</TableCell>{' '}
                {SCORE_SURFACES.map((surface) => {
                  const found = score.cells.find(
                    (candidate) => candidate.category === category && candidate.surface === surface,
                  );
                  return (
                    <TableCell key={surface} numeric>
                      {' '}
                      {found === undefined ? (
                        <span className="text-fg-muted">—</span>
                      ) : (
                        <MatrixCell cell={found} />
                      )}{' '}
                    </TableCell>
                  );
                })}{' '}
              </TableRow>
            ))}{' '}
          </TableBody>{' '}
        </Table>{' '}
        <p className="mt-3 max-w-measure text-pretty text-xs text-fg-muted">
          {' '}
          Bands: 0.60–1.00 healthy · 0.30–0.59 thin · below 0.30 failing ·{' '}
          <span className="font-semibold">unmeasured</span> means no coverage artifact was ingested,
          and is drawn in no band at all rather than as a colour.{' '}
        </p>{' '}
      </CardContent>{' '}
    </Card>
  );
}
/** A 0–1 fraction as a percentage. */ function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
export function coverageText(cell: ScoreCell): string {
  return cell.inputs.surfaceCoverage === null
    ? 'unmeasured'
    : `cov ${percent(cell.inputs.surfaceCoverage)}`;
}
function MatrixCell({ cell }: { cell: ScoreCell }): React.ReactElement {
  if (cell.excluded) {
    return (
      <span data-testid={`cell-${cell.key}`} className="text-fg-muted">
        {' '}
        n/a{' '}
      </span>
    );
  }
  const unmeasured = cell.inputs.surfaceCoverage === null;
  const tone = unmeasured ? { label: 'unmeasured', className: 'text-fg-muted' } : band(cell.score);
  return (
    <span data-testid={`cell-${cell.key}`} className="flex flex-col items-end gap-1">
      {' '}
      <span className="flex items-center gap-2">
        {' '}
        <svg
          data-testid={`cell-${cell.key}-swatch`}
          className={`h-3 w-10 shrink-0 ${tone.className}`}
          viewBox="0 0 40 12"
          role="img"
          aria-label={`${cell.key}: ${tone.label}`}
        >
          {' '}
          <rect
            x="0.5"
            y="0.5"
            width="39"
            height="11"
            rx="2"
            fill={unmeasured ? 'none' : 'currentColor'}
            stroke={unmeasured ? 'currentColor' : 'none'}
            strokeWidth={unmeasured ? 1 : 0}
            strokeDasharray={unmeasured ? '3 3' : undefined}
          />{' '}
        </svg>{' '}
        <span className="tabular-nums font-mono text-sm">{cell.score.toFixed(2)}</span>{' '}
      </span>{' '}
      <span className="text-xs text-fg-muted">{coverageText(cell)}</span>{' '}
    </span>
  );
}
/** The upper bound on what closing a gap is worth — a bound, and labelled as one. */ function potentialLabel(
  potential: number,
): string {
  return `worth up to +${(potential * 100).toFixed(0)} pts`;
}
/**
 * The decision queue: gaps ranked by what closing them is worth, then flaky cells.
 *
 * **Both lists are here because both name a closure.** `cheapestClosure` is
 * required by `GapSchema`, and a flaky cell is a closure too — fix it or
 * quarantine it. A list of fifteen cells at `0.00` with no action is not a
 * queue, it is the matrix again.
 */ function Queue({
  gaps,
  flaky,
}: {
  gaps: QaGapsResponse | null;
  flaky: QaFlakyResponse | null;
}): React.ReactElement {
  const ranked = (gaps?.gaps ?? [])
    .slice()
    .sort((left, right) => right.potential - left.potential || left.cell.localeCompare(right.cell));
  const flakyCells = (flaky?.cells ?? [])
    .slice()
    .sort((left, right) => right.flakeRate - left.flakeRate || left.cell.localeCompare(right.cell));
  return (
    <Card data-testid="main-queue">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle>Needs a decision</CardTitle>{' '}
        <CardDescription>
          {' '}
          Ranked by what closing each cell is worth to the total. A gap with no closure is not in
          this list — a cell with a low number is not a task.{' '}
        </CardDescription>{' '}
      </CardHeader>{' '}
      <CardContent>
        {' '}
        {ranked.length === 0 && flakyCells.length === 0 ? (
          <p className="text-sm text-fg-muted max-w-measure text-pretty">
            {' '}
            Nothing is queued: no cell is below its target and no fingerprint is flipping.{' '}
          </p>
        ) : null}{' '}
        <ul className="space-y-1">
          {' '}
          {ranked.map((gap) => (
            <li
              key={`gap-${gap.cell}`}
              data-testid={`queue-gap-${gap.cell}`}
              className="rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-bg-muted/50"
            >
              {' '}
              <div className="flex flex-wrap items-center gap-2">
                {' '}
                <span className="font-mono text-sm font-semibold">{gap.cell}</span>{' '}
                <Badge variant={band(gap.current).label === 'healthy' ? 'success' : 'warning'}>
                  {' '}
                  {gap.current.toFixed(2)} → {potentialLabel(gap.potential)}{' '}
                </Badge>{' '}
              </div>{' '}
              <p className="mt-1 max-w-measure text-pretty text-sm text-fg-muted">
                {' '}
                {gap.cheapestClosure}{' '}
              </p>{' '}
            </li>
          ))}{' '}
          {flakyCells.map((entry) => (
            <li
              key={`flaky-${entry.cell}`}
              data-testid={`queue-flaky-${entry.cell}`}
              className="rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-bg-muted/50"
            >
              {' '}
              <div className="flex flex-wrap items-center gap-2">
                {' '}
                <span className="font-mono text-sm font-semibold">{entry.cell}</span>{' '}
                <Badge variant="warning">
                  {' '}
                  {percent(entry.flakeRate)} flake · stability {entry.stability.toFixed(2)}{' '}
                </Badge>{' '}
              </div>{' '}
              <p className="mt-1 max-w-measure text-pretty text-sm text-fg-muted">
                {' '}
                {entry.flakyFingerprints.length} fingerprint(s) flip across the window:{' '}
                <span className="font-mono">{entry.flakyFingerprints.join(', ')}</span>. Fix or
                quarantine them.{' '}
              </p>{' '}
            </li>
          ))}{' '}
        </ul>{' '}
      </CardContent>{' '}
    </Card>
  );
}
/**
 * The automated quarantine engine: flaky fingerprints, ranked, with a
 * one-click suggestion to quarantine them.
 *
 * **A suggestion, not an action.** The button is a `POST` the API
 * already serves, so the engine proposes and the reader disposes — a
 * quarantine nobody reviewed is a test nobody owns.
 */ function QuarantineSuggestions({
  quarantine,
  flaky,
}: {
  quarantine: QuarantineEntry[] | null;
  flaky: QaFlakyResponse | null;
}): React.ReactElement {
  const flakyCells = (flaky?.cells ?? []).slice().sort((a, b) => b.flakeRate - a.flakeRate);
  const alreadyQuarantined = new Set(quarantine?.map((entry) => entry.testTitle) ?? []);
  const suggestions = flakyCells.flatMap((cell) =>
    cell.flakyFingerprints
      .filter((fingerprint) => !alreadyQuarantined.has(fingerprint))
      .map((fingerprint) => ({
        cell: cell.cell,
        fingerprint,
        flakeRate: cell.flakeRate,
        stability: cell.stability,
      })),
  );
  return (
    <Card data-testid="quarantine-suggestions">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle>Quarantine suggestions</CardTitle>{' '}
        <CardDescription>
          {' '}
          Fingerprints that flip across the window, ranked by flake rate. Each one is a suggestion:
          the engine proposes, and you decide.{' '}
        </CardDescription>{' '}
      </CardHeader>{' '}
      <CardContent>
        {' '}
        {suggestions.length === 0 ? (
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            {' '}
            Nothing to suggest: no fingerprint is flipping, or every flipper is already
            quarantined.{' '}
          </p>
        ) : (
          <Table>
            {' '}
            <TableHeader>
              {' '}
              <TableRow>
                {' '}
                <TableHead>Fingerprint</TableHead> <TableHead>Cell</TableHead>{' '}
                <TableHead className="text-right">Flake rate</TableHead>{' '}
                <TableHead className="text-right">Stability</TableHead>{' '}
                <TableHead>Suggestion</TableHead>{' '}
              </TableRow>{' '}
            </TableHeader>{' '}
            <TableBody>
              {' '}
              {suggestions.map((suggestion) => (
                <TableRow key={suggestion.fingerprint}>
                  {' '}
                  <TableCell>
                    {' '}
                    <code className="rounded bg-bg-muted px-2 py-0.5 font-mono text-xs">
                      {' '}
                      {suggestion.fingerprint}{' '}
                    </code>{' '}
                  </TableCell>{' '}
                  <TableCell className="font-mono text-sm">{suggestion.cell}</TableCell>{' '}
                  <TableCell numeric>
                    {' '}
                    <Badge
                      variant={
                        suggestion.flakeRate >= 0.3
                          ? 'danger'
                          : suggestion.flakeRate >= 0.1
                            ? 'warning'
                            : 'default'
                      }
                    >
                      {' '}
                      {(suggestion.flakeRate * 100).toFixed(1)}%{' '}
                    </Badge>{' '}
                  </TableCell>{' '}
                  <TableCell numeric>{suggestion.stability.toFixed(2)}</TableCell>{' '}
                  <TableCell>
                    {' '}
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`quarantine-suggest-${suggestion.fingerprint}`}
                      onClick={() => {
                        // The production client would POST to
                        // /api/v1/dashboard/quarantine here.
                        void suggestion;
                      }}
                    >
                      {' '}
                      Quarantine{' '}
                    </Button>{' '}
                  </TableCell>{' '}
                </TableRow>
              ))}{' '}
            </TableBody>{' '}
          </Table>
        )}{' '}
      </CardContent>{' '}
    </Card>
  );
}
/**
 * The QA stack: every tool in the registry, grouped by category and
 * split by tier, with what is detected and what is missing.
 *
 * **A prototype reads the registry, not the filesystem.** The browser
 * cannot list a repository's files, so the detected set is what the
 * API has already scanned. This list is the prototype's stand-in for
 * that scan, and the production client would replace it with a real
 * `/api/v1/projects/:id/files` read.
 */ function QaStack(): React.ReactElement {
  const [activeTab, setActiveTab] = React.useState('stack');
  const [tierFilter, setTierFilter] = React.useState<'all' | 'free' | 'paid' | 'freemium'>('all');
  const projectFiles = React.useMemo(
    () => [
      'package.json',
      'vitest.config.ts',
      'playwright.config.ts',
      'eslint.config.js',
      '.husky/pre-commit',
      'turbo.json',
      'apps/web/src/index.css',
      'packages/ui/src/index.ts',
    ],
    [],
  );
  /**
   * The stand-in for the server's scan, expressed as detection rows.
   *
   * **The browser cannot list a repository's files, so this list is a
   * stand-in and says so.** The engine takes per-tool detections rather than a
   * file list, so when the probe lands the only change is where the rows come
   * from — the rules that read them do not move again.
   */
  const detections = React.useMemo<readonly ToolDetection[]>(
    () =>
      QA_TOOLS_REGISTRY.map((tool) => {
        const matched = tool.detectPatterns.find((pattern) =>
          projectFiles.some((file) => file.includes(pattern)),
        );
        return {
          toolId: tool.id,
          detected: matched !== undefined,
          evidence: matched ?? null,
        };
      }),
    [projectFiles],
  );
  const { statuses, coverage } = React.useMemo(
    () => analyzeStack(QA_TOOLS_REGISTRY, detections),
    [detections],
  );
  const categories = React.useMemo(() => groupByCategory(QA_TOOLS_REGISTRY), []);
  const detectedTools = React.useMemo(
    () => statuses.filter((status) => status.detected),
    [statuses],
  );
  const missingEssentials = React.useMemo(
    () =>
      statuses.filter((status) => !status.detected && ESSENTIAL_TOOL_IDS.includes(status.tool.id)),
    [statuses],
  );
  const recommendedTools = React.useMemo(
    () =>
      statuses
        .filter((status) => !status.detected && !ESSENTIAL_TOOL_IDS.includes(status.tool.id))
        .slice(0, 8),
    [statuses],
  );
  const tierSummary = React.useMemo(() => {
    const summary = { free: 0, paid: 0, freemium: 0 };
    for (const tool of QA_TOOLS_REGISTRY) {
      summary[tool.tier] += 1;
    }
    return summary;
  }, []);
  const filteredCategories = React.useMemo(() => {
    if (tierFilter === 'all') return categories;
    return categories
      .map((category) => ({
        ...category,
        tools: category.tools.filter((tool) => tool.tier === tierFilter),
      }))
      .filter((category) => category.tools.length > 0);
  }, [categories, tierFilter]);
  return (
    <Card data-testid="qa-stack">
      {' '}
      <CardHeader>
        {' '}
        <CardTitle>QA stack</CardTitle>{' '}
        <CardDescription>
          {' '}
          Every tool in the registry, grouped by category and split by tier. Detection is
          declarative — a tool is present when its config or dependency appears in the project.{' '}
          {detectedTools.length} of {QA_TOOLS_REGISTRY.length} detected, {coverage}% coverage.{' '}
        </CardDescription>{' '}
      </CardHeader>{' '}
      <CardContent>
        {' '}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {' '}
          <StatCard
            data-testid="tools-total"
            title="Tools in registry"
            value={QA_TOOLS_REGISTRY.length}
          />{' '}
          <StatCard
            data-testid="tools-detected"
            title="Detected in project"
            value={detectedTools.length}
          />{' '}
          <StatCard
            data-testid="tools-missing"
            title="Missing essentials"
            value={missingEssentials.length}
          />{' '}
          <StatCard
            data-testid="tools-coverage"
            title="Stack coverage"
            value={`${coverage}%`}
            description={coverage >= 60 ? 'healthy' : 'thin'}
          />{' '}
        </div>{' '}
        {missingEssentials.length > 0 ? (
          <Alert data-testid="tools-missing-alert" variant="warning" className="mt-4">
            {' '}
            <AlertTitle>
              {' '}
              {missingEssentials.length} essential tool{missingEssentials.length === 1 ? '' : 's'}{' '}
              missing{' '}
            </AlertTitle>{' '}
            <AlertDescription>
              {' '}
              <p className="max-w-measure text-pretty">
                {' '}
                Every QA stack needs a unit framework, a browser automation tool, an accessibility
                engine, a linter, and git hooks. These are missing:{' '}
              </p>{' '}
              <ul className="mt-2 space-y-1">
                {' '}
                {missingEssentials.map((status) => (
                  <li key={status.tool.id} className="flex items-center justify-between gap-2">
                    {' '}
                    <span className="font-medium">{status.tool.name}</span>{' '}
                    <code className="rounded bg-bg-muted px-2 py-0.5 font-mono text-xs">
                      {' '}
                      {status.tool.installCommand}{' '}
                    </code>{' '}
                  </li>
                ))}{' '}
              </ul>{' '}
            </AlertDescription>{' '}
          </Alert>
        ) : null}{' '}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          {' '}
          <TabsList>
            {' '}
            <TabsTrigger value="stack">Stack</TabsTrigger>{' '}
            <TabsTrigger value="recommendations">Recommendations</TabsTrigger>{' '}
            <TabsTrigger value="detected">Detected</TabsTrigger>{' '}
          </TabsList>{' '}
          <TabsContent value="stack" className="space-y-4">
            {' '}
            <div className="grid gap-4 sm:grid-cols-3">
              {' '}
              {(Object.keys(tierSummary) as Array<keyof typeof tierSummary>).map((tier) => (
                <div
                  key={tier}
                  data-testid={`tier-${tier}`}
                  className="rounded-md border border-border-default p-4"
                >
                  {' '}
                  <div className="flex items-center justify-between gap-2">
                    {' '}
                    <span className="text-sm font-medium">{TIER_LABELS[tier]} Tier</span>{' '}
                    <Badge variant={TIER_VARIANT[tier]}>{tierSummary[tier]}</Badge>{' '}
                  </div>{' '}
                  <Meter
                    className="mt-3"
                    label={`${TIER_LABELS[tier]} tier share`}
                    value={
                      QA_TOOLS_REGISTRY.length === 0
                        ? 0
                        : tierSummary[tier] / QA_TOOLS_REGISTRY.length
                    }
                    variant={tier === 'free' ? 'success' : tier === 'paid' ? 'warning' : 'neutral'}
                  />{' '}
                </div>
              ))}{' '}
            </div>{' '}
            <div className="flex flex-wrap gap-2">
              {' '}
              <Button
                variant={tierFilter === 'all' ? 'secondary' : 'ghost'}
                onClick={() => setTierFilter('all')}
                data-testid="tier-filter-all"
              >
                {' '}
                All{' '}
              </Button>{' '}
              <Button
                variant={tierFilter === 'free' ? 'secondary' : 'ghost'}
                onClick={() => setTierFilter('free')}
                data-testid="tier-filter-free"
              >
                {' '}
                Free{' '}
              </Button>{' '}
              <Button
                variant={tierFilter === 'paid' ? 'secondary' : 'ghost'}
                onClick={() => setTierFilter('paid')}
                data-testid="tier-filter-paid"
              >
                {' '}
                Paid{' '}
              </Button>{' '}
              <Button
                variant={tierFilter === 'freemium' ? 'secondary' : 'ghost'}
                onClick={() => setTierFilter('freemium')}
                data-testid="tier-filter-freemium"
              >
                {' '}
                Freemium{' '}
              </Button>{' '}
            </div>{' '}
            {filteredCategories.map((category) => (
              <Card key={category.id} data-testid={`category-${category.id}`}>
                {' '}
                <CardHeader>
                  {' '}
                  <CardTitle>{category.name}</CardTitle>{' '}
                  <CardDescription>{category.description}</CardDescription>{' '}
                </CardHeader>{' '}
                <CardContent>
                  {' '}
                  <ToolTable tools={category.tools} statuses={statuses} />{' '}
                </CardContent>{' '}
              </Card>
            ))}{' '}
          </TabsContent>{' '}
          <TabsContent value="recommendations" className="space-y-4">
            {' '}
            <Card>
              {' '}
              <CardHeader>
                {' '}
                <CardTitle>Tooling Recommendations</CardTitle>{' '}
                <CardDescription>
                  {' '}
                  Tools your stack does not have yet, with the reason each one is worth adding. The
                  first eight gaps, ranked by how essential the category is.{' '}
                </CardDescription>{' '}
              </CardHeader>{' '}
              <CardContent>
                {' '}
                {recommendedTools.length === 0 ? (
                  <EmptyState
                    title="Stack is complete"
                    description="Every category has a detected tool."
                  />
                ) : (
                  <ul className="space-y-2">
                    {' '}
                    {recommendedTools.map((status) => (
                      <li
                        key={status.tool.id}
                        data-testid={`recommendation-${status.tool.id}`}
                        className="rounded-md border border-border-default p-4"
                      >
                        {' '}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {' '}
                          <div className="flex items-center gap-2">
                            {' '}
                            <span className="font-semibold">{status.tool.name}</span>{' '}
                            <Badge variant={TIER_VARIANT[status.tool.tier]}>
                              {' '}
                              {TIER_LABELS[status.tool.tier]}{' '}
                            </Badge>{' '}
                            <Badge variant="outline">
                              {CATEGORY_LABELS[status.tool.category]}
                            </Badge>{' '}
                          </div>{' '}
                          <code className="rounded bg-bg-muted px-2 py-0.5 font-mono text-xs">
                            {' '}
                            {status.tool.installCommand}{' '}
                          </code>{' '}
                        </div>{' '}
                        <p className="mt-2 max-w-measure text-pretty text-sm text-fg-muted">
                          {' '}
                          {status.tool.description}{' '}
                        </p>{' '}
                        <p className="mt-1 text-xs text-fg-muted max-w-measure">
                          {' '}
                          Learning curve: {status.tool.learningCurve} · Home:{' '}
                          <a
                            href={status.tool.homepage}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                          >
                            {' '}
                            {status.tool.homepage.replace(/^https:\/\//u, '')}{' '}
                          </a>{' '}
                        </p>{' '}
                      </li>
                    ))}{' '}
                  </ul>
                )}{' '}
              </CardContent>{' '}
            </Card>{' '}
          </TabsContent>{' '}
          <TabsContent value="detected" className="space-y-4">
            {' '}
            <Card>
              {' '}
              <CardHeader>
                {' '}
                <CardTitle>Detected tools</CardTitle>{' '}
                <CardDescription>
                  {' '}
                  {detectedTools.length} of {QA_TOOLS_REGISTRY.length} tools are present, with the
                  file that says so.{' '}
                </CardDescription>{' '}
              </CardHeader>{' '}
              <CardContent>
                {' '}
                {detectedTools.length === 0 ? (
                  <EmptyState
                    title="No tools detected"
                    description="The project scan found none of the registry's detect patterns."
                  />
                ) : (
                  <Table>
                    {' '}
                    <TableHeader>
                      {' '}
                      <TableRow>
                        {' '}
                        <TableHead>Tool</TableHead> <TableHead>Category</TableHead>{' '}
                        <TableHead>Tier</TableHead> <TableHead>Evidence</TableHead>{' '}
                      </TableRow>{' '}
                    </TableHeader>{' '}
                    <TableBody>
                      {' '}
                      {detectedTools.map((status) => (
                        <TableRow key={status.tool.id}>
                          {' '}
                          <TableCell className="font-medium">{status.tool.name}</TableCell>{' '}
                          <TableCell>{CATEGORY_LABELS[status.tool.category]}</TableCell>{' '}
                          <TableCell>
                            {' '}
                            <Badge variant={TIER_VARIANT[status.tool.tier]}>
                              {' '}
                              {TIER_LABELS[status.tool.tier]}{' '}
                            </Badge>{' '}
                          </TableCell>{' '}
                          <TableCell>
                            {' '}
                            <code className="rounded bg-bg-muted px-2 py-0.5 font-mono text-xs">
                              {' '}
                              {status.evidence}{' '}
                            </code>{' '}
                          </TableCell>{' '}
                        </TableRow>
                      ))}{' '}
                    </TableBody>{' '}
                  </Table>
                )}{' '}
              </CardContent>{' '}
            </Card>{' '}
          </TabsContent>{' '}
        </Tabs>{' '}
      </CardContent>{' '}
    </Card>
  );
}
/**
 * One category's tools, as a table.
 *
 * The tier badge is the first column after the name because the tier is
 * the question a QA engineer asks first, and the install command is
 * copy-ready.
 */ function ToolTable({
  tools,
  statuses,
}: {
  tools: readonly QATool[];
  statuses: readonly ToolStatus[];
}): React.ReactElement {
  return (
    <Table>
      {' '}
      <TableHeader>
        {' '}
        <TableRow>
          {' '}
          <TableHead>Tool</TableHead> <TableHead>Tier</TableHead> <TableHead>Installed</TableHead>{' '}
          <TableHead>Description</TableHead> <TableHead>Install</TableHead>{' '}
        </TableRow>{' '}
      </TableHeader>{' '}
      <TableBody>
        {' '}
        {tools.map((tool) => {
          const status = statuses.find((candidate) => candidate.tool.id === tool.id);
          return (
            <TableRow key={tool.id}>
              {' '}
              <TableCell className="font-medium">
                {' '}
                <a
                  href={tool.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  {' '}
                  {tool.name}{' '}
                </a>{' '}
              </TableCell>{' '}
              <TableCell>
                {' '}
                <Badge variant={TIER_VARIANT[tool.tier]}>{TIER_LABELS[tool.tier]}</Badge>{' '}
              </TableCell>{' '}
              <TableCell>
                {' '}
                {status?.detected ? (
                  <Badge variant="success">Yes</Badge>
                ) : (
                  <Badge variant="outline">No</Badge>
                )}{' '}
              </TableCell>{' '}
              <TableCell className="max-w-measure text-pretty text-sm text-fg-muted">
                {' '}
                {tool.description}{' '}
              </TableCell>{' '}
              <TableCell>
                {' '}
                <code className="rounded bg-bg-muted px-2 py-0.5 font-mono text-xs">
                  {' '}
                  {tool.installCommand}{' '}
                </code>{' '}
              </TableCell>{' '}
            </TableRow>
          );
        })}{' '}
      </TableBody>{' '}
    </Table>
  );
}
/**
 * The empty state that is a screen.
 *
 * Two ways out, both named, because "nothing here" is indistinguishable from
 * "broken" if the screen only says nothing. With no registry row there is also no
 * detected folder to show — discovery registers nothing it could not detect a suite
 * in — so naming the environment variable is the honest instruction rather than a
 * guessed path.
 */ function Onboarding(): React.ReactElement {
  return (
    <div data-testid="main-onboarding" className="space-y-4">
      {' '}
      <header>
        {' '}
        <h1 className="text-3xl font-bold">Automate</h1>{' '}
        <p className="mt-2 max-w-measure text-sm text-fg-muted">
          {' '}
          No project is registered, so there is nothing to score yet. This is an empty install, not
          a failure — but the two look identical from here, so here is how to leave it.{' '}
        </p>{' '}
      </header>{' '}
      <Card>
        {' '}
        <CardHeader>
          {' '}
          <CardTitle>Point the API at a folder</CardTitle>{' '}
          <CardDescription>
            {' '}
            Set <span className="font-mono">AUTOMATE_PROJECT_ROOT</span> to the checkout you want
            analysed and restart the API. It registers and re-detects that folder at boot, and there
            is no default: in compose the working directory is{' '}
            <span className="font-mono">/app</span>, and a default would register the container as
            your project.{' '}
          </CardDescription>{' '}
        </CardHeader>{' '}
        <CardContent>
          {' '}
          <p className="text-sm text-fg-muted max-w-measure text-pretty">
            {' '}
            Or register one by hand, which also works for a folder no detector recognises:{' '}
            <span className="font-mono">POST /api/v1/projects</span> with{' '}
            <span className="font-mono">name</span>, <span className="font-mono">slug</span> and{' '}
            <span className="font-mono">repoPath</span>.{' '}
          </p>{' '}
        </CardContent>{' '}
      </Card>{' '}
    </div>
  );
}
