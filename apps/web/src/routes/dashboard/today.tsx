import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardDescription,
  EmptyState,
  GLASS_SURFACE_CLASSES,
  Skeleton,
} from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import { useResource } from '../../hooks/useResource.js';
import { readFindings, type Finding } from '../../lib/findings.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import { defaultApiClient, type ApiClient } from '../../lib/api.js';
import type { Decision, DecisionTimeline, ScoreDelta } from '../../lib/qa.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/today',
  component: () => <TodayPage />,
});

/**
 * How far back "what changed" reaches.
 *
 * **A day, because the screen is read once a day.** The score diff is a
 * recomputation at both ends of a window, so the window is a question, not a
 * fact: a week answers "what changed this week", a day answers "what changed
 * since yesterday", and a screen that silently chose one for the reader would be
 * answering a question they did not ask. One day is the window the sentence
 * above the screen promises.
 */
const CHANGED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One read's answer, or the sentence explaining why there is none. */
interface Reading<T> {
  value: T | null;
  failure: string | null;
}

/**
 * The four blocks, each settled on its own.
 *
 * **Four independent reads, and the independence is the point.** The screen is a
 * dashboard about a loop: yesterday's score, what broke, what is waiting, what
 * was decided. Any one of those endpoints can be down, and a screen that waited
 * for all four before drawing anything would show nothing while three quarters of
 * it was true. So each block carries its own `failure`, and `partial` — the state
 * where one read answered and another did not — is a first-class state with its own
 * test-id, not an accident.
 */
interface TodayLoads {
  changed: Reading<ScoreDelta>;
  broke: Reading<readonly Finding[]>;
  waiting: Reading<{ roster: readonly Decision[]; rows: readonly Decision[] }>;
  decided: Reading<DecisionTimeline>;
}

/**
 * The daily screen: what changed, what broke, what is waiting, what was decided.
 *
 * ## Why this screen exists
 *
 * The cockpit answers "what is the score". This one answers "what do I do today",
 * which is four different questions: the score's movement, the findings the engine
 * derives from seven reads, the decisions nobody has made, and the decisions
 * somebody has. Each one already had a screen or an endpoint; none of them was
 * **the daily page**, and the loop this product exists to close was spread over
 * four tabs nobody opens in order.
 *
 * ## Every number names its source
 *
 * The reads are `readFindings` (the shared engine — no second copy of a rule),
 * `qa/score/diff` for the movement, the decision predicates from F0.1 for the
 * queue, and the timeline from F0.4 for the history. Nothing on this screen is
 * computed twice: a total is read, a finding is derived, a verdict is read, and
 * the screen renders what it was given.
 */
export function TodayPage({
  api = defaultApiClient,
  qa,
  projectId,
}: {
  api?: ApiClient;
  qa?: QaClient;
  projectId?: string;
}) {
  // **The owner the inbox is read for, and `null` is everyone.** The product has
  // no session to read an identity from, and inventing one would be a screen
  // asking "whose work is this?" about a team it does not know. So the default
  // is the honest open one and the picker narrows a question the reader chose.
  const [owner, setOwner] = React.useState<string | null>(null);
  const loads = useResource<TodayLoads>(
    (signal) => loadToday(api, qa ?? createQaClient(), projectId, owner, signal),
    [api, qa, projectId, owner],
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8" data-testid="today-page">
      {/*
        One h1, and only one: the four states render inside this shell rather than
        each bringing a title of its own, which is the rule `Composition.test.tsx`
        enforces on every screen in this directory.
      */}
      <h1 className="mb-1 text-balance text-3xl font-bold tracking-tight text-text-primary">
        Today
      </h1>
      <p className="mb-8 max-w-measure text-pretty text-sm text-fg-muted">
        What moved, what broke, what is waiting on a decision, and what has already been decided.
        Each block names the endpoint it read, because a number you cannot trace is a number you
        have to trust.
      </p>

      {projectId === undefined ? (
        <EmptyState
          data-testid="today-no-project"
          title="No project selected"
          description="Pick a project on the cockpit first — today is about one stack at a time."
          action={
            <a
              href="/dashboard"
              className="rounded-md border border-border px-3 py-2 text-sm text-fg transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-border-focus focus-visible:outline-offset-2"
            >
              Choose a project on the cockpit
            </a>
          }
        />
      ) : (
        <>
          {loads.status === 'loading' && (
            <div className="flex flex-col gap-4" data-testid="today-loading">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {loads.status === 'error' && (
            <EmptyState
              data-testid="today-error"
              title="Today is unavailable"
              description={loads.message}
            />
          )}

          {loads.status === 'ready' && (
            <TodayBody loads={loads.value} owner={owner} onOwner={setOwner} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The four blocks, once every read has settled.
 *
 * The whole-body states are decided here rather than in the screen, because they
 * are a claim about the *set*: `empty` means all four answered and all four were
 * empty, and `partial` means at least one failed while at least one answered.
 * Neither is a claim about one block, and neither can be made by a block about
 * itself.
 */
function TodayBody({
  loads,
  owner,
  onOwner,
}: {
  loads: TodayLoads;
  owner: string | null;
  onOwner: (owner: string | null) => void;
}) {
  const readings: ReadonlyArray<Reading<unknown>> = [
    loads.changed,
    loads.broke,
    loads.waiting,
    loads.decided,
  ];
  const failed = readings.filter((reading) => reading.failure !== null);

  if (failed.length === readings.length) {
    // **The screen's whole-body error, and it means "everything is down"** —
    // which is a different sentence from "nothing happened today". One read
    // failing is `partial` below; four failing is this.
    return (
      <EmptyState
        data-testid="today-error"
        title="Today is unavailable"
        description={failed
          .map((reading) => reading.failure)
          .filter((message): message is string => message !== null)
          .join(' · ')}
      />
    );
  }

  const empty =
    failed.length === 0 &&
    (loads.changed.value?.contributions.length ?? 0) === 0 &&
    (loads.broke.value?.length ?? 0) === 0 &&
    (loads.waiting.value?.rows.length ?? 0) === 0 &&
    (loads.decided.value?.undecided.count ?? 0) === 0 &&
    (loads.decided.value?.weeks.every((week) => week.total === 0) ?? true);

  return (
    <div className="flex flex-col gap-8">
      {/*
        **Partial is a state, not a degraded render.** One read answered and
        another did not, and the honest screen says which rather than showing
        three blocks and a blank fourth as though the fourth were a zero. The
        alert names the failures; the blocks below it still render what was true.
      */}
      {failed.length > 0 && (
        <Alert variant="warning" data-testid="today-partial">
          <AlertTitle>Some of today did not load</AlertTitle>
          <AlertDescription>
            {failed
              .map((reading) => reading.failure)
              .filter((message): message is string => message !== null)
              .join(' · ')}
          </AlertDescription>
        </Alert>
      )}

      {empty && (
        <EmptyState
          data-testid="today-empty"
          title="Nothing to report today"
          description="No score movement, no derived findings, no pending verdicts, and no verdicts this week. The loop has not started — or the repository is quiet."
        />
      )}

      {!empty && (
        <>
          <section aria-labelledby="today-changed" data-testid="today-changed-section">
            <h2
              id="today-changed"
              className="mb-4 text-xl font-semibold tracking-tight text-text-primary"
            >
              What changed
            </h2>
            <ChangedBlock changed={loads.changed} />
          </section>

          <section aria-labelledby="today-broke" data-testid="today-broke-section">
            <h2
              id="today-broke"
              className="mb-4 text-xl font-semibold tracking-tight text-text-primary"
            >
              What broke
            </h2>
            <BrokeBlock broke={loads.broke} pending={loads.waiting.value?.rows.length ?? 0} />
          </section>

          <section aria-labelledby="today-waiting" data-testid="today-waiting-section">
            <h2
              id="today-waiting"
              className="mb-4 text-xl font-semibold tracking-tight text-text-primary"
            >
              What is waiting on a decision
            </h2>
            <WaitingBlock waiting={loads.waiting} owner={owner} onOwner={onOwner} />
          </section>

          <section aria-labelledby="today-decided" data-testid="today-decided-section">
            <h2
              id="today-decided"
              className="mb-4 text-xl font-semibold tracking-tight text-text-primary"
            >
              What was decided
            </h2>
            <DecidedBlock decided={loads.decided} />
          </section>
        </>
      )}
    </div>
  );
}

/**
 * The score's movement over one day, and the cells that moved.
 *
 * **A diff is not a verdict.** The two totals are recomputations at either end of
 * the window, so the block shows both ends and every contribution with the cause
 * it names — never a bare delta, which is the only number on this screen that
 * could be faked by choosing the other end of the window.
 */
function ChangedBlock({ changed }: { changed: Reading<ScoreDelta> }) {
  if (changed.failure !== null) {
    return (
      <Card className="p-5" data-testid="today-changed-failure">
        <CardDescription>The score did not answer: {changed.failure}</CardDescription>
      </Card>
    );
  }
  // **`value` is non-null exactly when `failure` is**, and the failure branch
  // above has already returned — so this is the answered case or nothing. The
  // cast states the invariant once, by hand, because TypeScript cannot see it
  // through the callback that built the reading. A `=== null` guard instead
  // would be a branch no test can reach, which is worse than one cast with a
  // reason beside it.
  const delta = changed.value as ScoreDelta;
  const movement = delta.currentTotal - delta.previousTotal;
  // **The limiter is a row id, not a number** — which is why the diff carries it
  // at both ends: a total that moved is one answer, and a total that stayed put
  // because its limiter changed is a different one, and only the second needs a
  // reader to go and look.
  const capped =
    delta.previousCappedBy === delta.currentCappedBy
      ? null
      : `${delta.previousCappedBy} → ${delta.currentCappedBy}`;

  return (
    <div className="flex flex-col gap-4" data-testid="today-changed">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">Then → now</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {delta.previousTotal.toFixed(2)} → {delta.currentTotal.toFixed(2)}
          </p>
        </div>
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">Movement</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {movement > 0 ? '+' : ''}
            {movement.toFixed(2)}
          </p>
        </div>
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">Limiter now</p>
          <p className="mt-1 text-lg font-semibold text-text-primary">{delta.currentCappedBy}</p>
        </div>
      </div>
      {capped !== null && (
        <p className="max-w-measure text-pretty text-sm text-fg-muted">
          The limiter changed: {capped}. A diff whose limiter moved is answering a different
          question than the one it answered yesterday.
        </p>
      )}
      {delta.contributions.length === 0 ? (
        <p
          className="max-w-measure text-pretty text-sm text-fg-muted"
          data-testid="today-changed-flat"
        >
          Nothing moved in this window: the same inputs produced the same total.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="today-changed-contributions">
          {delta.contributions.map((contribution) => (
            <li
              key={`${contribution.scope}:${contribution.key}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
            >
              <Badge variant="secondary">{contribution.scope}</Badge>
              <span className="font-mono text-fg">{contribution.key}</span>
              <span className="tabular-nums text-text-primary">
                {contribution.before.toFixed(2)} → {contribution.after.toFixed(2)}
              </span>
              <span className="max-w-measure text-pretty text-xs text-fg-muted">
                {contribution.cause}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the engine derived, and how many findings are waiting for a verdict.
 *
 * **The pending count is the funnel's entry, not a summary of it.** The findings
 * above are what the rules fired on; the number beside them is how many of those
 * have no verdict recorded at all, which is the difference between a suite that
 * is being measured and one that is being decided about.
 */
function BrokeBlock({ broke, pending }: { broke: Reading<readonly Finding[]>; pending: number }) {
  if (broke.failure !== null) {
    return (
      <Card className="p-5" data-testid="today-broke-failure">
        <CardDescription>The findings engine did not answer: {broke.failure}</CardDescription>
      </Card>
    );
  }
  const findings = broke.value ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="today-broke">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">Findings</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {findings.length}
          </p>
        </div>
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">
            Waiting for a verdict
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{pending}</p>
        </div>
      </div>
      {findings.length === 0 ? (
        <p className="max-w-measure text-pretty text-sm text-fg-muted">
          No rule fired: no zero row, no flaky cell, no hollow test, no pending verdict.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="today-broke-list">
          {findings.map((finding) => (
            <li
              key={finding.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
              data-testid={`today-finding-${finding.id}`}
            >
              <Badge
                variant={
                  finding.severity === 'critical'
                    ? 'danger'
                    : finding.severity === 'warning'
                      ? 'warning'
                      : 'secondary'
                }
              >
                {finding.severity}
              </Badge>
              <span className="font-medium text-text-primary">{finding.title}</span>
              <span className="max-w-measure text-pretty text-xs text-fg-muted">
                {finding.action}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The open decisions, oldest first, filtered to one owner if the reader chose one.
 *
 * **The queue's order is the server's, and the predicate is the server's too.**
 * The screen asks `?verdict=open&ownerId=` rather than filtering a list it
 * fetched whole, because a client-side filter would be a second copy of the
 * ordering rule — the exact thing the parity suite pins against SQL. The roster
 * of owners comes from the unfiltered read, which happens in the same load: it is
 * the same request when no owner is picked, and a second one when one is.
 */
function WaitingBlock({
  waiting,
  owner,
  onOwner,
}: {
  waiting: Reading<{ roster: readonly Decision[]; rows: readonly Decision[] }>;
  owner: string | null;
  onOwner: (owner: string | null) => void;
}) {
  if (waiting.failure !== null) {
    return (
      <Card className="p-5" data-testid="today-waiting-failure">
        <CardDescription>The decision queue did not answer: {waiting.failure}</CardDescription>
      </Card>
    );
  }
  const rows = waiting.value?.rows ?? [];
  const roster = [
    ...new Set(
      (waiting.value?.roster ?? [])
        .map((row) => row.ownerId)
        .filter((name): name is string => name !== null && name.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return (
    <div className="flex flex-col gap-4" data-testid="today-waiting">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by owner">
        <button
          type="button"
          onClick={() => {
            onOwner(null);
          }}
          aria-pressed={owner === null}
          className={`rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-border-focus focus-visible:outline-offset-2 ${
            owner === null
              ? 'border-border-focus bg-surface-raised text-text-primary'
              : 'border-border text-fg-muted hover:text-fg'
          }`}
        >
          Everyone
        </button>
        {roster.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              onOwner(name);
            }}
            aria-pressed={owner === name}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-border-focus focus-visible:outline-offset-2 ${
              owner === name
                ? 'border-border-focus bg-surface-raised text-text-primary'
                : 'border-border text-fg-muted hover:text-fg'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p
          className="max-w-measure text-pretty text-sm text-fg-muted"
          data-testid="today-waiting-none"
        >
          {owner === null
            ? 'Nothing is waiting: every derived finding has a verdict.'
            : `Nothing is waiting on ${owner}.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="today-waiting-list">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
              data-testid={`today-waiting-${row.findingId}`}
            >
              <span className="font-mono text-fg">{row.findingId}</span>
              {row.cell !== null && (
                <span className="font-mono text-xs text-fg-muted">{row.cell}</span>
              )}
              {row.ownerId !== null && <Badge variant="secondary">{row.ownerId}</Badge>}
              <span className="max-w-measure text-pretty text-xs text-fg-muted">
                Since {new Date(row.createdAt).toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * This week's verdicts: how many, by whom, and what nobody has called.
 *
 * **A week with no verdicts is a week the loop stopped.** The timeline endpoint
 * keeps the empty week in the answer rather than omitting it, which is what makes
 * that sentence printable at all — a timeline that dropped quiet weeks would read
 * as a timeline of weeks nobody looked at.
 */
function DecidedBlock({ decided }: { decided: Reading<DecisionTimeline> }) {
  if (decided.failure !== null) {
    return (
      <Card className="p-5" data-testid="today-decided-failure">
        <CardDescription>The decision timeline did not answer: {decided.failure}</CardDescription>
      </Card>
    );
  }
  // Same invariant as the block above, and the same reason for stating it once
  // rather than guarding a branch nothing can reach.
  const timeline = decided.value as DecisionTimeline;
  const current = timeline.weeks[timeline.weeks.length - 1];
  const verdicts = current === undefined ? [] : Object.entries(current.counts);

  return (
    <div className="flex flex-col gap-4" data-testid="today-decided">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">
            Verdicts this week
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {current?.total ?? 0}
          </p>
          <p className="max-w-measure text-xs text-fg-muted">Week of {current?.week ?? '—'}</p>
        </div>
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">
            No verdict at all
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
            {timeline.undecided.count}
          </p>
        </div>
        <div className={`p-4 ${GLASS_SURFACE_CLASSES}`}>
          <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">Decided by</p>
          <ul className="mt-1 flex flex-col text-xs text-fg">
            {timeline.owners.length === 0 && <li className="text-fg-muted">nobody</li>}
            {timeline.owners.map((entry) => (
              <li key={entry.ownerId ?? 'unnamed'} className="flex justify-between gap-3">
                <span>{entry.ownerId ?? 'unnamed'}</span>
                <span className="tabular-nums">{entry.decided}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {current !== undefined && current.total === 0 ? (
        <p
          className="max-w-measure text-pretty text-sm text-fg-muted"
          data-testid="today-decided-quiet"
        >
          No verdicts recorded this week. A week with no verdicts is a week the loop stopped.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="today-decided-voices">
          {verdicts
            .filter(([, count]) => count > 0)
            .map(([verdict, count]) => (
              <li key={verdict} className="flex items-baseline gap-2">
                <Badge variant="secondary">{verdict}</Badge>
                <span className="tabular-nums text-text-primary">{count}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The four reads, settled independently, into one screen.
 *
 * ## The order is a dependency, not a preference
 *
 * The timeline's `undecided` count is *exact only when it names the engine's
 * finding ids* — the findings are a pure function of seven reads, not a table, so
 * the server cannot know them and must be told. So the findings are read first and
 * their ids are handed to the timeline read; the other two are concurrent.
 *
 * That is also why the timeline waits: a call that passed no ids would answer
 * `0` about an empty set, which reads as "nothing is undecided" on a screen whose
 * headline question is the opposite.
 */
async function loadToday(
  api: ApiClient,
  qa: QaClient,
  projectId: string | undefined,
  owner: string | null,
  signal: AbortSignal,
): Promise<TodayLoads> {
  // **No project, no reads.** The screen asks for one rather than rendering a
  // day about nothing, and the early return is what makes that literal: a read
  // issued for an unnamed project is a read of nothing that still costs a round
  // trip and still looks like an answer.
  if (projectId === undefined) {
    return {
      changed: { value: null, failure: null },
      broke: { value: [], failure: null },
      waiting: { value: { roster: [], rows: [] }, failure: null },
      decided: { value: null, failure: null },
    };
  }
  const since = new Date(Date.now() - CHANGED_WINDOW_MS).toISOString();
  const [changed, broke, roster] = await Promise.allSettled([
    qa.getScoreDiff(projectId, since),
    readFindings(api, qa, projectId, signal),
    qa.getDecisions(projectId, { verdict: 'open' }),
  ]);

  // The reader answers `{ findings, failures }` — a shape, not the list — because
  // a read that failed is a `failure` on the engine's own terms rather than an
  // empty list this screen would have to invent.
  const brokeReading = reading(broke);
  const findings = brokeReading.value?.findings ?? [];
  const engineFailures = brokeReading.value?.failures ?? [];
  const findingIds = findings.map((finding) => finding.id);

  // The filtered read is the same request as the roster read until an owner is
  // picked, so the unfiltered path costs one read and the filtered one costs two
  // — and neither filters on the client, which would be a second copy of the
  // ordering rule the parity suite pins against SQL.
  const filtered =
    owner === null
      ? { value: settledValue(roster), failure: null }
      : await settleOne(qa.getDecisions(projectId, { verdict: 'open', ownerId: owner }));

  const decided = await settleOne(qa.getTimeline(projectId, { weeks: 1, findingIds }));

  return {
    changed: reading(changed),
    broke: {
      value: findings,
      failure:
        engineFailures.length === 0
          ? null
          : `the findings engine read ${engineFailures.join(', ')} without an answer`,
    },
    waiting: {
      value: { roster: settledValue(roster), rows: filtered.value ?? [] },
      failure: filtered.failure ?? reading(roster).failure,
    },
    decided,
  };
}

/** One settled promise, as a reading. */
async function settleOne<T>(promise: Promise<T>): Promise<Reading<T>> {
  try {
    return { value: await promise, failure: null };
  } catch (error: unknown) {
    return { value: null, failure: error instanceof Error ? error.message : 'not available' };
  }
}

/** One settled promise's value, or the empty list. */
function settledValue(result: PromiseSettledResult<readonly Decision[]>): readonly Decision[] {
  return result.status === 'fulfilled' ? result.value : [];
}

/** One settled promise, as a reading — shared by the reads that all settle at once. */
function reading<T>(result: PromiseSettledResult<T>): Reading<T> {
  if (result.status === 'fulfilled') return { value: result.value, failure: null };
  const reason = result.reason;
  return { value: null, failure: reason instanceof Error ? reason.message : 'not available' };
}
