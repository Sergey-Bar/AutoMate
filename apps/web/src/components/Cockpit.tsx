import React from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import {
  PYRAMID_ROW,
  SCORE_CATEGORIES,
  SCORE_SURFACES,
  type ScoreCell,
} from '@automate/shared-contracts';
import type { QaClient } from '../lib/qa-client';
import type { QaFlakyResponse, QaGapsResponse, QaScore, RegisteredProject } from '../lib/qa';
import type { AnalyticsSummary, ApiClient, QuarantineEntry } from '../lib/api';
import { useResource } from '../hooks/useResource';

/**
 * The cockpit: one screen, read top to bottom in about three seconds.
 *
 * ## What this screen is for
 *
 * "What is blocking me." Everything else is subordinate to that sentence, which is
 * why the layout is not negotiable: the limiting term first, the numbers it explains
 * next, the queue below that, and the total — the one number nobody can act on —
 * last and smallest.
 *
 * ## The four rules it will not break
 *
 * 1. **The limiter is the headline.** The total is a weighted *geometric* mean with
 *    `min(1)` renormalisation, so one cell at `0.00` caps everything and the other
 *    fourteen become nearly irrelevant. `total: 72, cappedBy: security,
 *    cappingValue: 0` is not "a score of 72"; it is "one row is empty". Rendering
 *    the 72 as the hero with the limiter as grey small print underneath is still a
 *    lie of emphasis, because the eye takes the big number.
 *
 * 2. **A cell nobody measured gets no colour.** `cell.inputs.surfaceCoverage` is
 *    `null` whenever no coverage artifact was ingested, and over HTTP it is
 *    `null` for *every* cell: `qaScore` takes coverage as a caller-supplied
 *    document and no route accepts one. Colouring those cells would draw confident
 *    green on a dimension nobody measured, so an unmeasured cell is drawn in no
 *    band at all and says `unmeasured`.
 *
 * 3. **No number without its window.** Every tile states the instant it was read
 *    at. There is no delta to show, because there is no comparison yet — and saying
 *    so is better than a bare pass rate, which is a number and not an answer.
 *
 * 4. **A gap that names no closure is not in the queue.** `cheapestClosure` is
 *    required by the contract; a gap without one is a cell with a low number, and
 *    ranking fifteen of those is how a queue stops being a queue.
 *
 * ## Five parallel fetches, and no aggregate endpoint
 *
 * `analytics/summary`, `qa/score`, `qa/flaky`, `qa/gaps` and `dashboard/quarantine`.
 * A `/cockpit` route would be a second authority over numbers that already have five
 * endpoints, and it would be the first thing to drift. Each is settled
 * independently: one failing endpoint names itself and the other four still render,
 * because a screen that empties when one of five reads fails is a screen that reads
 * a failure as "there is nothing here".
 *
 * The clients arrive as **props**, following every other screen in this directory.
 * A module singleton would have to be replaced before the module loaded, which is a
 * test that passes or fails on import order.
 */

/** One endpoint's answer, or the sentence explaining why there is none. */
interface Reading<T> {
  value: T | null;
  failure: string | null;
}

interface CockpitSnapshot {
  analytics: Reading<AnalyticsSummary>;
  score: Reading<QaScore>;
  flaky: Reading<QaFlakyResponse>;
  gaps: Reading<QaGapsResponse>;
  quarantine: Reading<QuarantineEntry[]>;
}

const FIVE: readonly (keyof CockpitSnapshot)[] = [
  'analytics',
  'score',
  'flaky',
  'gaps',
  'quarantine',
];

export function Cockpit({
  qa,
  api,
  projectId,
}: {
  qa: QaClient;
  api: ApiClient;
  /** Which project to report on. Defaults to the first registered one. */
  projectId?: string;
}): React.ReactElement {
  const registry = useResource<RegisteredProject[]>(() => qa.listProjects(), [qa]);

  if (registry.status === 'loading') {
    return (
      <div data-testid="cockpit-loading" className="text-sm text-fg-muted">
        Reading the registry…
      </div>
    );
  }
  if (registry.status === 'error') {
    return (
      <EmptyState
        data-testid="cockpit-registry-error"
        title="The project registry is unavailable"
        description={registry.message}
      />
    );
  }

  const projects = registry.value;
  const subject = projectId === undefined ? projects[0] : projects.find((p) => p.id === projectId);

  // **Onboarding is a screen, not an empty grid.** An empty table cannot distinguish
  // "no project yet" from "the API is broken", and those need opposite responses.
  if (subject === undefined) {
    return <Onboarding />;
  }

  return <CockpitBody qa={qa} api={api} subject={subject} />;
}

function CockpitBody({
  qa,
  api,
  subject,
}: {
  qa: QaClient;
  api: ApiClient;
  subject: RegisteredProject;
}): React.ReactElement {
  const snapshot = useResource<CockpitSnapshot>(
    (signal) => loadFive(api, qa, subject.id, signal),
    [api, qa, subject.id],
  );

  if (snapshot.status === 'loading') {
    return (
      <div data-testid="cockpit-loading" className="text-sm text-fg-muted">
        Reading five endpoints for {subject.name}…
      </div>
    );
  }
  if (snapshot.status === 'error') {
    return (
      <EmptyState
        data-testid="cockpit-load-error"
        title="Could not read the cockpit"
        description={snapshot.message}
      />
    );
  }

  const { flaky, gaps, score } = snapshot.value;
  const failures = FIVE.filter((name) => snapshot.value[name].failure !== null);

  return (
    <div data-testid="cockpit" className="space-y-6">
      <header>
        {/*
          `text-3xl`, which is now a step on the **declared** ladder in `theme.css`
          (`--text-3xl: 2.074rem`, `base` × 1.2³) rather than Tailwind's default it
          inherited for as long as the ladder existed only in a table with no importer. It
          compiles to the same 1.875rem it always did; what changed is that a test can now
          say whether it is the right size.
        */}
        <h1 className="text-balance text-3xl font-bold tracking-tight">Automate</h1>
        {/*
          Which folder this is about, stated rather than assumed. The cockpit reports
          on one project; with several registered, saying so is the difference between
          a verdict and a guess. `max-w-measure` because this line is prose and the
          measure is the ceiling `theme.css` declares for prose.
        */}
        <p
          data-testid="cockpit-subject"
          className="mt-2 max-w-measure text-pretty text-sm text-fg-muted"
        >
          {subject.name} · {subject.repoPath ?? 'no repository path recorded'}
        </p>
      </header>

      {failures.length > 0 ? <FailureNotice snapshot={snapshot.value} /> : null}

      <Limiter score={score.value} />

      <StatRow snapshot={snapshot.value} />

      {score.value === null ? null : <Matrix score={score.value} />}

      <Queue gaps={gaps.value} flaky={flaky.value} />

      {score.value === null ? null : <PyramidStrip score={score.value} />}
    </div>
  );
}

/**
 * Five reads, settled independently, in one round trip's worth of wall clock.
 *
 * `Promise.allSettled` rather than `Promise.all`, because the whole point of the
 * failures list below is that one dead endpoint must not empty the screen. A
 * rejected `all` would make the other four answers unreachable, which is the
 * failure mode the screen exists to avoid: a screen that empties when a read fails
 * is a screen that reads the failure as "there is nothing here".
 */
async function loadFive(
  api: ApiClient,
  qa: QaClient,
  projectId: string,
  signal: AbortSignal,
): Promise<CockpitSnapshot> {
  const settled = await Promise.allSettled([
    api.getAnalyticsSummary({ signal }),
    qa.getScore(projectId),
    qa.getFlaky(projectId),
    qa.getGaps(projectId),
    api.getQuarantine({ signal }),
  ]);
  const [analytics, score, flaky, gaps, quarantine] = settled;
  return {
    analytics: read(analytics),
    score: read(score),
    flaky: read(flaky),
    gaps: read(gaps),
    quarantine: read(quarantine),
  };
}

/** The endpoint's own sentence, not `error.message` — see `use-resource.ts`. */
function read<T>(settled: PromiseSettledResult<T>): Reading<T> {
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

/** Which endpoint failed, and what it said. */
const ENDPOINT_NAMES: Record<keyof CockpitSnapshot, string> = {
  analytics: 'dashboard/analytics/summary',
  score: 'qa/score',
  flaky: 'qa/flaky',
  gaps: 'qa/gaps',
  quarantine: 'dashboard/quarantine',
};

function FailureNotice({ snapshot }: { snapshot: CockpitSnapshot }): React.ReactElement {
  return (
    <div
      data-testid="cockpit-failures"
      role="alert"
      className="rounded-md border border-warning p-4 text-sm"
    >
      <p className="font-semibold text-warning">
        {FIVE.filter((name) => snapshot[name].failure !== null).length} of five reads failed
      </p>
      <ul className="mt-2 space-y-1 text-fg-muted">
        {FIVE.filter((name) => snapshot[name].failure !== null).map((name) => (
          <li key={name} data-testid={`cockpit-failure-${name}`}>
            <span className="font-mono">{ENDPOINT_NAMES[name]}</span> — {snapshot[name].failure}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-fg-muted max-w-measure text-pretty">
        Everything below is what the reads that answered. A missing row is a read that failed, not a
        measurement of zero.
      </p>
    </div>
  );
}

/**
 * The headline: the term that limited the total, and why that is the number to read.
 *
 * Reads `cappedBy` and `cappingValue` rather than re-deriving the limiter. The
 * server resolved it with the weights it actually used, and a client that re-derived
 * it would be a second implementation of the mean — which is the one thing this
 * product must not have.
 */
function Limiter({ score }: { score: QaScore | null }): React.ReactElement {
  if (score === null) {
    return (
      <Card data-testid="cockpit-limiter">
        <CardHeader>
          <CardTitle>Blocking you</CardTitle>
          <p className="text-sm text-fg-muted max-w-measure text-pretty">
            The score could not be read, so nothing is claiming to know what is blocking you.
          </p>
        </CardHeader>
      </Card>
    );
  }
  const zeroed = score.cappingValue === 0;
  return (
    <Card data-testid="cockpit-limiter" className="border-accent">
      <CardHeader>
        <CardTitle className="tracking-widest text-fg-muted text-xs uppercase">
          Blocking you
        </CardTitle>
        <p className="mt-2 text-4xl font-bold">
          <span className="font-mono">{score.cappedBy}</span>
          <span className="ml-2 tabular-nums text-2xl font-semibold text-danger">
            {score.cappingValue.toFixed(2)}
          </span>
        </p>
        <p className="mt-3 max-w-measure text-pretty text-sm text-fg-muted">
          {zeroed
            ? 'One zero caps the geometric mean, so the total below is the other rows and one empty one. Closing this row moves the total more than anything else you could do.'
            : `This row contributes the largest weighted shortfall to the geometric mean. Closing it moves the total more than any other row.`}
        </p>
      </CardHeader>
    </Card>
  );
}

function StatRow({ snapshot }: { snapshot: CockpitSnapshot }): React.ReactElement {
  const { analytics, score, gaps, quarantine } = snapshot;
  return (
    <section aria-label="Run and suite totals" className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          data-testid="cockpit-stat-pass"
          title="Pass rate"
          value={analytics.value === null ? 'unread' : asPercent(analytics.value.passRate)}
        />
        <StatCard
          data-testid="cockpit-stat-runs"
          title="Runs"
          value={analytics.value === null ? 'unread' : analytics.value.totalRuns}
        />
        <StatCard
          data-testid="cockpit-stat-gaps"
          title="Gaps"
          value={gaps.value === null ? 'unread' : gaps.value.gaps.length}
        />
        <StatCard
          data-testid="cockpit-stat-quarantine"
          title="Quarantine"
          value={quarantine.value === null ? 'unread' : quarantine.value.length}
        />
        {/*
          The total, deliberately last and deliberately small. It is the one number on
          this screen that cannot be acted on: with a geometric mean, a reader cannot
          tell from it which row to work on, and the reason for that is already above
          in a much larger font.
        */}
        <StatCard
          data-testid="cockpit-total"
          title="Total (footnote — read the limiter first)"
          value={score.value === null ? 'unread' : score.value.total.toFixed(1)}
          description={
            score.value === null ? undefined : `as of ${score.value.at} · no comparison window yet`
          }
        />
      </div>
      <p className="text-xs text-fg-muted max-w-measure text-pretty">
        No delta is shown because no comparison instant has been chosen. A bare pass rate is a
        number, not an answer.
      </p>
    </section>
  );
}

/**
 * A 0–1 fraction as a percentage.
 *
 * For `surfaceCoverage` and `flakeRate`, which really are fractions.
 */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * A 0–100 percentage as a percentage.
 *
 * **Two formatters because the cockpit reads two shapes, and reading them with one is how
 * the headline number reached 6700%.** `analytics.passRate` arrives already scaled — the API
 * returns `50`, `75`, `100` (`apps/api/src/modules/dashboard/analytics.test.ts`) and
 * `apps/web/src/routes/dashboard/analytics.tsx` renders it as `{data.passRate}%` without
 * touching it — while `surfaceCoverage` and `flakeRate` are 0–1. Multiplying both by 100
 * printed a 67% pass rate as **6700.0%**, and no test noticed because the one mock that
 * exercised this number used the fraction shape. The functions are named for what the value
 * *is* rather than for the unit they print, so the next value to arrive is classified by its
 * source rather than by habit.
 *
 * The screenshot that found it is `test-results/evidence/glass/cockpit-*.png`, taken by
 * `e2e/accessibility/routes.spec.ts`.
 */
function asPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * The 5×3 grid, one `<rect>` per cell.
 *
 * **Inline SVG, and no chart library.** Fifteen cells and one sparkline do not
 * justify a 200 kB dependency and a second visual language; a heat cell is a
 * `<rect>` and a colour token.
 *
 * The colour is on the `<svg>` as `text-*` and the `<rect>` fills with
 * `currentColor`, because a Tailwind `fill-*` utility would be a second colour path
 * that `theme-resolution.test.ts` has to resolve and nobody would remember to extend.
 */
function Matrix({ score }: { score: QaScore }): React.ReactElement {
  return (
    <Card data-testid="cockpit-matrix">
      <CardHeader>
        <CardTitle>The matrix</CardTitle>
        <p className="max-w-measure text-pretty text-sm text-fg-muted">
          Five categories by three surfaces. Every cell carries its own inputs, so no number here is
          unexplained.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>category</TableHead>
              {SCORE_SURFACES.map((surface) => (
                <TableHead key={surface} className="text-right">
                  {surface}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {SCORE_CATEGORIES.map((category) => (
              <TableRow key={category}>
                <TableCell className="font-medium">{category}</TableCell>
                {SCORE_SURFACES.map((surface) => {
                  const found = score.cells.find(
                    (candidate) => candidate.category === category && candidate.surface === surface,
                  );
                  return (
                    <TableCell key={surface} numeric>
                      {found === undefined ? (
                        <span className="text-fg-muted">—</span>
                      ) : (
                        <MatrixCell cell={found} />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 max-w-measure text-pretty text-xs text-fg-muted">
          Bands: 0.60–1.00 healthy · 0.30–0.59 thin · below 0.30 failing ·{' '}
          <span className="font-semibold">unmeasured</span> means no coverage artifact was ingested,
          and is drawn in no band at all rather than as a colour.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * One cell: a band for the measured health, and coverage as its own state.
 *
 * `coverageText` is the rule that matters. A cell with `surfaceCoverage === null` has
 * had **no coverage measured**, and it says so in words; the band beside it describes
 * the other three components and is drawn neutral so it cannot be read as a verdict on
 * coverage. `null` is absence, not zero — colouring it red would report a Python-only
 * repository as measurably uncovered.
 */
export function coverageText(cell: ScoreCell): string {
  return cell.inputs.surfaceCoverage === null
    ? 'unmeasured'
    : `cov ${percent(cell.inputs.surfaceCoverage)}`;
}

function band(value: number): { label: string; className: string } {
  if (value >= 0.6) return { label: 'healthy', className: 'text-success' };
  if (value >= 0.3) return { label: 'thin', className: 'text-warning' };
  return { label: 'failing', className: 'text-danger' };
}

function MatrixCell({ cell }: { cell: ScoreCell }): React.ReactElement {
  if (cell.excluded) {
    return (
      <span data-testid={`cell-${cell.key}`} className="text-fg-muted">
        n/a
      </span>
    );
  }
  const unmeasured = cell.inputs.surfaceCoverage === null;
  /*
   * A cell nobody measured is drawn as an **outlined placeholder**, not as a bar in a
   * muted ink.
   *
   * It used to be a solid 40×12 `<rect>` with `fill="currentColor"` in `text-fg-muted`,
   * which at a glance is a failed image load: a flat rectangle with nothing in it, in a
   * row where every other cell is a coloured bar. The glass plan's screenshot review named
   * exactly that reading, and no assertion caught it because every assertion about this
   * cell was about *which colour* it uses and this cell correctly uses none.
   *
   * `fill="none"` with a dashed `currentColor` stroke of the same width says "nothing here"
   * in the same visual grammar as a progress bar that has not started, which is what it
   * is. The score beside it is still real — depth, stability and signal were three
   * measured components — so it is still shown, in the neutral ink so the row cannot be
   * read as a coverage verdict.
   */
  const tone = unmeasured ? { label: 'unmeasured', className: 'text-fg-muted' } : band(cell.score);
  return (
    <span data-testid={`cell-${cell.key}`} className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        <svg
          data-testid={`cell-${cell.key}-swatch`}
          className={`h-3 w-10 shrink-0 ${tone.className}`}
          viewBox="0 0 40 12"
          role="img"
          aria-label={`${cell.key}: ${tone.label}`}
        >
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
          />
        </svg>
        <span className="tabular-nums font-mono text-sm">{cell.score.toFixed(2)}</span>
      </span>
      <span className="text-xs text-fg-muted">{coverageText(cell)}</span>
    </span>
  );
}

/**
 * The decision queue: gaps ranked by what closing them is worth, then flaky cells.
 *
 * **Both lists are here because both name a closure.** `cheapestClosure` is required
 * by `GapSchema`, and a flaky cell is a closure too — fix it or quarantine it. A list
 * of fifteen cells at `0.00` with no action is not a queue, it is the matrix again.
 */
function Queue({
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
    <Card data-testid="cockpit-queue">
      <CardHeader>
        <CardTitle>Needs a decision</CardTitle>
        <p className="max-w-measure text-pretty text-sm text-fg-muted">
          Ranked by what closing each cell is worth to the total. A gap with no closure is not in
          this list — a cell with a low number is not a task.
        </p>
      </CardHeader>
      <CardContent>
        {ranked.length === 0 && flakyCells.length === 0 ? (
          <p className="text-sm text-fg-muted max-w-measure text-pretty">
            Nothing is queued: no cell is below its target and no fingerprint is flipping.
          </p>
        ) : null}
        <ul className="space-y-1">
          {ranked.map((gap) => (
            /*
              A row, with a surface. The queue is a list a person scans with their eye
              rather than reads top to bottom, and fifteen rows of identical text on one
              flat plane give the eye nothing to track: no row can be located again after
              the next saccade. `rounded-md` plus `border-transparent` means the border
              costs nothing at rest and appears on hover, so the resting state is still a
              list rather than a stack of boxes.
              */
            <li
              key={`gap-${gap.cell}`}
              data-testid={`queue-gap-${gap.cell}`}
              className="rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-bg-muted/50"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{gap.cell}</span>
                <Badge variant={band(gap.current).label === 'healthy' ? 'success' : 'warning'}>
                  {gap.current.toFixed(2)} → {potentialLabel(gap.potential)}
                </Badge>
              </div>
              <p className="mt-1 max-w-measure text-pretty text-sm text-fg-muted">
                {gap.cheapestClosure}
              </p>
            </li>
          ))}
          {flakyCells.map((entry) => (
            <li
              key={`flaky-${entry.cell}`}
              data-testid={`queue-flaky-${entry.cell}`}
              className="rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-bg-muted/50"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{entry.cell}</span>
                <Badge variant="warning">
                  {percent(entry.flakeRate)} flake · stability {entry.stability.toFixed(2)}
                </Badge>
              </div>
              <p className="mt-1 max-w-measure text-pretty text-sm text-fg-muted">
                {entry.flakyFingerprints.length} fingerprint(s) flip across the window:{' '}
                <span className="font-mono">{entry.flakyFingerprints.join(', ')}</span>. Fix or
                quarantine them.
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The upper bound on what closing a gap is worth — a bound, and labelled as one. */
function potentialLabel(potential: number): string {
  return `worth up to +${(potential * 100).toFixed(0)} pts`;
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
 */
/**
 * A share vector as percentages, and never as a raw float.
 *
 * `pyramid.observed` and `pyramid.target` are **shares of the executed tests**, not
 * counts: `PyramidTarget` is bounded `[0,1]` and `pyramidShape` divides by the total
 * before it compares. Printed raw, the strip said `Observed 0.8148148148148148 unit`
 * — sixteen digits of a fraction that reads as a count of tests. Rounding to whole
 * percent is also the precision the claim deserves: a share of 0.8148 is not a
 * measurement, it is three tests out of fifty-three.
 */
function shares(vector: { unit: number; integration: number; e2e: number }): string {
  return `${Math.round(vector.unit * 100)}% / ${String(Math.round(vector.integration * 100))}% / ${String(Math.round(vector.e2e * 100))}%`;
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
 */
function PyramidStrip({ score }: { score: QaScore }): React.ReactElement {
  const { pyramid } = score;
  const row = score.rows.find((candidate) => candidate.id === PYRAMID_ROW);
  return (
    <Card data-testid="cockpit-pyramid">
      <CardHeader>
        <CardTitle className="tracking-widest text-fg-muted text-xs uppercase">
          Suite shape — {PYRAMID_ROW}
        </CardTitle>
        <p className="mt-2 tabular-nums font-mono text-2xl font-bold">{pyramid.shape.toFixed(2)}</p>
        <p className="mt-1 max-w-measure tabular-nums text-pretty text-sm text-fg-muted">
          Observed {shares(pyramid.observed)} unit / integration / e2e.{' '}
          {pyramid.declaredTarget === null
            ? 'Target — none declared, so no drift is claimed.'
            : `Target ${shares(pyramid.declaredTarget)} against a drift of ${pyramid.drift.toFixed(2)}.`}
          {row === undefined ? '' : ` · weight ${row.weight.toFixed(2)}`}
          {row === undefined ? '' : ` · ${String(row.includedCells)} cells included`}
        </p>
      </CardHeader>
    </Card>
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
 */
function Onboarding(): React.ReactElement {
  return (
    <div data-testid="cockpit-onboarding" className="space-y-4">
      <header>
        <h1 className="text-3xl font-bold">Automate</h1>
        <p className="mt-2max-w-measure text-sm text-fg-muted">
          No project is registered, so there is nothing to score yet. This is an empty install, not
          a failure — but the two look identical from here, so here is how to leave it.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Point the API at a folder</CardTitle>
          <p className="text-sm text-fg-muted max-w-measure text-pretty">
            Set <span className="font-mono">AUTOMATE_PROJECT_ROOT</span> to the checkout you want
            analysed and restart the API. It registers and re-detects that folder at boot, and there
            is no default: in compose the working directory is{' '}
            <span className="font-mono">/app</span>, and a default would register the container as
            your project.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-muted max-w-measure text-pretty">
            Or register one by hand, which also works for a folder no detector recognises:{' '}
            <span className="font-mono">POST /api/v1/projects</span> with{' '}
            <span className="font-mono">name</span>, <span className="font-mono">slug</span> and{' '}
            <span className="font-mono">repoPath</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
