import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayPage } from './today.js';
import type { ApiClient } from '../../lib/api.js';
import type { QaClient } from '../../lib/qa-client.js';

afterEach(() => {
  // Module-level mocks, cleared between cases — otherwise a "was called with"
  // assertion asserts about the previous test's call history.
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The daily screen, against the four reads it renders.
 *
 * ## What is proven here
 *
 * The plan's gate for F0.2 is four blocks on one screen, each naming the endpoint
 * it read. That is a *screen* property, so these tests drive the injected client
 * rather than `fetch`: what is asserted is that a block renders the read it was
 * given, that the states are distinct, and that the two F0 reads happen with the
 * predicates the plan names — `?verdict=open&ownerId=` for the queue, and the
 * engine's finding ids for the timeline, because an undecided count computed
 * against no findings is `0` about nothing.
 */

/** The empty day: every read answers, and every answer is empty. */
function scoreDelta(contributions: unknown[] = []): unknown {
  return {
    projectId: 'p1',
    from: '2026-10-11T00:00:00.000Z',
    to: '2026-10-12T00:00:00.000Z',
    previousTotal: 10,
    currentTotal: 10,
    // The limiter is a **row id**, not a number: a total that did not move
    // because its limiter changed is the answer only these two fields carry.
    previousCappedBy: 'security',
    currentCappedBy: 'security',
    contributions,
  };
}

function timeline(overrides: Record<string, unknown> = {}): unknown {
  return {
    window: { from: '2026-10-12T00:00:00.000Z', to: '2026-10-19T00:00:00.000Z', weeks: 1 },
    weeks: [
      {
        week: '2026-10-12',
        counts: { open: 0, accepted: 0, fixed: 1, excluded: 0, deferred: 0 },
        total: 1,
      },
    ],
    owners: [{ ownerId: 'reviewer-1', decided: 1 }],
    undecided: { count: 1, findingIds: ['zero-caps-mean'] },
    ...overrides,
  };
}

/** A client whose every read answers, unless an override says otherwise. */
function qaClient(overrides: Partial<QaClient> = {}): QaClient {
  return {
    getScoreDiff: vi.fn().mockResolvedValue(scoreDelta()),
    getScore: vi.fn().mockResolvedValue({
      projectId: 'p1',
      total: 42,
      cappedBy: 'security',
      cappingValue: 0,
      cells: [],
      surfaces: {},
      rows: [],
      pyramid: {},
      gaps: [],
      findings: [],
      provenance: {},
      weights: {},
      trend: { points: [], labels: [] },
    }),
    getFlaky: vi.fn().mockResolvedValue({ cells: [] }),
    getGaps: vi.fn().mockResolvedValue({ cappedBy: 'security', gaps: [] }),
    getHollow: vi.fn().mockResolvedValue({ cells: [] }),
    getStructure: vi.fn().mockResolvedValue({ findings: [] }),
    getProject: vi.fn(),
    getDecisions: vi.fn().mockResolvedValue([
      {
        id: 'd-1',
        projectId: 'p1',
        findingId: 'zero-caps-mean',
        cell: 'security:frontend',
        verdict: 'open',
        ownerId: 'reviewer-1',
        decidedAt: null,
        note: null,
        deferUntil: null,
        createdAt: '2026-10-09T10:00:00.000Z',
        updatedAt: '2026-10-09T10:00:00.000Z',
      },
    ]),
    getTimeline: vi.fn().mockResolvedValue(timeline()),
    ...overrides,
  } as unknown as QaClient;
}

/** The two reads the findings engine needs that are not on the QA client. */
function apiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getAnalyticsSummary: vi.fn().mockResolvedValue({
      totalRuns: 12,
      passRate: 91,
      avgDurationMs: 4200,
    }),
    getQuarantine: vi.fn().mockResolvedValue([]),
    getKpiSummary: vi.fn().mockResolvedValue({ kpis: [] }),
    ...overrides,
  } as unknown as ApiClient;
}

describe('TodayPage', () => {
  it('renders all four blocks, each naming the read it came from', async () => {
    const qa = qaClient({
      getScoreDiff: vi.fn().mockResolvedValue(
        scoreDelta([
          {
            scope: 'row',
            key: 'security',
            before: 0,
            after: 0.4,
            cause: 'a security result was reclassified',
            // **`evidence` is required, not optional**: a contribution that
            // cannot cite a row is a number with no story, and the contract
            // refuses it rather than trusting every client to remember.
            evidence: ['run-abc123'],
          },
        ]),
      ),
    });
    render(<TodayPage api={apiClient()} qa={qa} projectId="p1" />);

    // What changed: both ends of the window, the movement, and the contribution
    // with the cause it names — never a bare delta.
    const changed = await screen.findByTestId('today-changed');
    expect(changed).toHaveTextContent('10.00 → 10.00');
    expect(changed).toHaveTextContent('Movement0.00');
    expect(within(changed).getByTestId('today-changed-contributions')).toHaveTextContent(
      'a security result was reclassified',
    );

    // What broke: the findings engine's answer, and the pending count beside it.
    const broke = screen.getByTestId('today-broke');
    expect(within(broke).getByTestId('today-broke-list')).toBeInTheDocument();
    expect(within(broke).getByTestId('today-finding-zero-caps-mean')).toBeInTheDocument();

    // Waiting on a decision: the open row, oldest first, with its owner.
    const waiting = screen.getByTestId('today-waiting');
    expect(within(waiting).getByTestId('today-waiting-zero-caps-mean')).toHaveTextContent(
      'reviewer-1',
    );

    // What was decided: this week's verdicts, by owner, and the undecided count.
    const decided = screen.getByTestId('today-decided');
    expect(decided).toHaveTextContent('Week of 2026-10-12');
    expect(decided).toHaveTextContent('No verdict at all');

    // **The timeline is asked with the engine's ids.** An undecided count computed
    // against an empty set is `0` about nothing, which on this screen's headline
    // question is the wrong answer rather than a small one.
    expect(qa.getTimeline).toHaveBeenCalledWith('p1', {
      weeks: 1,
      findingIds: expect.arrayContaining(['zero-caps-mean', 'pass-rate']),
    });
    // And the queue is asked with the inbox predicate.
    expect(qa.getDecisions).toHaveBeenCalledWith('p1', { verdict: 'open' });
  });

  it('asks the server for the owner it is filtered to, rather than filtering a list itself', async () => {
    const getDecisions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'd-1',
          projectId: 'p1',
          findingId: 'zero-caps-mean',
          cell: 'security:frontend',
          verdict: 'open',
          ownerId: 'reviewer-1',
          decidedAt: null,
          note: null,
          deferUntil: null,
          createdAt: '2026-10-09T10:00:00.000Z',
          updatedAt: '2026-10-09T10:00:00.000Z',
        },
        {
          id: 'd-2',
          projectId: 'p1',
          findingId: 'pass-rate',
          cell: null,
          verdict: 'open',
          ownerId: 'reviewer-2',
          decidedAt: null,
          note: null,
          deferUntil: null,
          createdAt: '2026-10-10T10:00:00.000Z',
          updatedAt: '2026-10-10T10:00:00.000Z',
        },
      ])
      .mockResolvedValue([
        {
          id: 'd-2',
          projectId: 'p1',
          findingId: 'pass-rate',
          cell: null,
          verdict: 'open',
          ownerId: 'reviewer-2',
          decidedAt: null,
          note: null,
          deferUntil: null,
          createdAt: '2026-10-10T10:00:00.000Z',
          updatedAt: '2026-10-10T10:00:00.000Z',
        },
      ]);
    render(<TodayPage api={apiClient()} qa={qaClient({ getDecisions })} projectId="p1" />);

    await screen.findByTestId('today-waiting-list');
    await userEvent.click(screen.getByRole('button', { name: 'reviewer-2' }));

    // The predicate travels to the server, which owns the ordering rule; the
    // roster of chips came from the unfiltered read, not from a second fetch.
    // **`findBy`, not `getBy`**: the owner change re-reads the day, and the
    // screen is honestly in its loading state until that read settles.
    await within(await screen.findByTestId('today-waiting')).findByTestId(
      'today-waiting-pass-rate',
    );
    expect(getDecisions).toHaveBeenCalledWith('p1', { verdict: 'open', ownerId: 'reviewer-2' });

    // And back to everyone: the filter is the reader's, and removing it is one
    // press rather than a page the reader cannot get out of.
    await userEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(getDecisions).toHaveBeenCalledWith('p1', { verdict: 'open' });
  });

  it('says nothing is waiting, rather than rendering an empty queue', async () => {
    render(
      <TodayPage
        api={apiClient()}
        qa={qaClient({ getDecisions: vi.fn().mockResolvedValue([]) })}
        projectId="p1"
      />,
    );
    const none = await screen.findByTestId('today-waiting-none');
    expect(none).toHaveTextContent('Nothing is waiting');
  });

  it('says nothing is waiting on the owner it was filtered to', async () => {
    // The filtered read is its own request, and an empty answer to it names the
    // owner — "nothing is waiting" about everyone would be a different sentence
    // about a different question.
    const getDecisions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'd-1',
          projectId: 'p1',
          findingId: 'zero-caps-mean',
          cell: null,
          verdict: 'open',
          ownerId: 'reviewer-2',
          decidedAt: null,
          note: null,
          deferUntil: null,
          createdAt: '2026-10-10T10:00:00.000Z',
          updatedAt: '2026-10-10T10:00:00.000Z',
        },
      ])
      .mockResolvedValue([]);
    render(<TodayPage api={apiClient()} qa={qaClient({ getDecisions })} projectId="p1" />);
    await screen.findByTestId('today-waiting-list');
    await userEvent.click(screen.getByRole('button', { name: 'reviewer-2' }));
    const none = await screen.findByTestId('today-waiting-none');
    expect(none).toHaveTextContent('Nothing is waiting on reviewer-2');
  });

  it('reports the quiet week the loop stopped in, as a sentence', async () => {
    const quiet = timeline({
      weeks: [
        {
          week: '2026-10-12',
          counts: { open: 0, accepted: 0, fixed: 0, excluded: 0, deferred: 0 },
          total: 0,
        },
      ],
      owners: [],
      undecided: { count: 1, findingIds: ['zero-caps-mean'] },
    });
    render(
      <TodayPage
        api={apiClient()}
        qa={qaClient({ getTimeline: vi.fn().mockResolvedValue(quiet) })}
        projectId="p1"
      />,
    );
    const sentence = await screen.findByTestId('today-decided-quiet');
    expect(sentence).toHaveTextContent('a week the loop stopped');
  });

  it('separates the empty day from the day that did not load', async () => {
    // Every read answers, and every answer is empty. That is the fresh install's
    // honest state, and it is the only way to reach it: **the engine's reads
    // answer with nothing at all**, because a rule fires on a value and a
    // rejection is an error state rather than an empty one.
    const nothing = qaClient({
      getScoreDiff: vi.fn().mockResolvedValue(scoreDelta()),
      getScore: vi.fn().mockResolvedValue(null),
      getFlaky: vi.fn().mockResolvedValue(null),
      getGaps: vi.fn().mockResolvedValue(null),
      getHollow: vi.fn().mockResolvedValue(null),
      getStructure: vi.fn().mockResolvedValue(null),
      getDecisions: vi.fn().mockResolvedValue([]),
      getTimeline: vi.fn().mockResolvedValue(
        timeline({
          weeks: [
            {
              week: '2026-10-12',
              counts: { open: 0, accepted: 0, fixed: 0, excluded: 0, deferred: 0 },
              total: 0,
            },
          ],
          owners: [],
          undecided: { count: 0, findingIds: [] },
        }),
      ),
    });
    const emptyApi = apiClient({
      getAnalyticsSummary: vi.fn().mockResolvedValue(null),
      getQuarantine: vi.fn().mockResolvedValue(null),
    });
    render(<TodayPage api={emptyApi} qa={nothing} projectId="p1" />);
    const state = await screen.findByTestId('today-empty');
    expect(state).toHaveTextContent('Nothing to report today');
  });

  it('names the whole-body failure when every read failed', async () => {
    const broken = qaClient({
      getScoreDiff: vi.fn().mockRejectedValue(new Error('diff is down')),
      getDecisions: vi.fn().mockRejectedValue(new Error('decisions are down')),
      getTimeline: vi.fn().mockRejectedValue(new Error('timeline is down')),
    });
    const brokenApi = apiClient({
      getAnalyticsSummary: vi.fn().mockRejectedValue(new Error('analytics are down')),
    });
    render(<TodayPage api={brokenApi} qa={broken} projectId="p1" />);
    const state = await screen.findByTestId('today-error');
    expect(state).toHaveTextContent('Today is unavailable');
    expect(state).toHaveTextContent('diff is down');
  });

  it('renders what was true when one read failed and the others answered', async () => {
    // **Partial is a state, not a degraded render.** The timeline is down; the
    // other three blocks are still true, and the alert names the failure rather
    // than the screen silently showing a shorter page.
    const partial = qaClient({
      getTimeline: vi.fn().mockRejectedValue(new Error('timeline is down')),
    });
    render(<TodayPage api={apiClient()} qa={partial} projectId="p1" />);
    const alert = await screen.findByTestId('today-partial');
    expect(alert).toHaveTextContent('timeline is down');
    expect(screen.getByTestId('today-changed')).toBeInTheDocument();
    expect(screen.getByTestId('today-broke')).toBeInTheDocument();
    expect(screen.getByTestId('today-waiting')).toBeInTheDocument();
  });

  it('renders the day as loading until every read has settled', async () => {
    // **The honest in-flight state.** The screen re-reads all four blocks when the
    // owner changes, and a skeleton is what a reader should see while that
    // happens — not a partially-filled page that claims to be today.
    const pending = qaClient({
      getScoreDiff: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<TodayPage api={apiClient()} qa={pending} projectId="p1" />);
    expect(screen.getByTestId('today-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('today-changed')).not.toBeInTheDocument();
  });

  it('asks for a project rather than rendering a day about nothing', () => {
    const api = apiClient();
    render(<TodayPage api={api} qa={qaClient()} />);
    expect(screen.getByTestId('today-no-project')).toBeInTheDocument();
    // No calls at all: today is about one stack, and the reads below would be
    // reads of nothing.
    expect(api.getAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('says which block did not answer, and still renders the rest', async () => {
    // **One failure per block, each named where it is.** The sentence for a
    // block that did not answer is not the block's content, and a screen that
    // rendered "no movement" for a score endpoint that never answered would be
    // reporting a quiet day instead of a dead one. Three of four failed, so this
    // is partial — the fourth (the engine) answered in full.
    const three = qaClient({
      getScoreDiff: vi.fn().mockRejectedValue(new Error('diff is down')),
      getDecisions: vi.fn().mockRejectedValue(new Error('queue is down')),
      getTimeline: vi.fn().mockRejectedValue(new Error('timeline is down')),
    });
    render(<TodayPage api={apiClient()} qa={three} projectId="p1" />);

    const partial = await screen.findByTestId('today-partial');
    expect(partial).toHaveTextContent('diff is down');
    expect(partial).toHaveTextContent('queue is down');
    expect(partial).toHaveTextContent('timeline is down');
    expect(screen.getByTestId('today-changed-failure')).toHaveTextContent('diff is down');
    expect(screen.getByTestId('today-waiting-failure')).toHaveTextContent('queue is down');
    expect(screen.getByTestId('today-decided-failure')).toHaveTextContent('timeline is down');
    // The block that did answer is still rendered: a partial day is three
    // quarters of a day, not no day.
    expect(screen.getByTestId('today-broke')).toBeInTheDocument();
  });

  it('names the engine read that did not answer, among the seven', async () => {
    // One of the engine's seven reads is dead. The rule that fired on it cannot
    // know, and the engine says which endpoint is missing rather than answering
    // about half a suite — the whole point of `readFindings` being shared.
    const oneDown = qaClient({
      getScore: vi.fn().mockRejectedValue(new Error('score is down')),
    });
    render(<TodayPage api={apiClient()} qa={oneDown} projectId="p1" />);
    const partial = await screen.findByTestId('today-partial');
    expect(partial).toHaveTextContent('qa/score');
    expect(screen.getByTestId('today-broke-failure')).toHaveTextContent('qa/score');
  });

  it('names a limiter that changed even though the total did not', async () => {
    // **The case the diff exists for.** A total that stayed put is not the whole
    // answer when the row capping it moved: the reader has to be told, or the
    // next reader concludes nothing happened.
    const moved = qaClient({
      getScoreDiff: vi.fn().mockResolvedValue({
        ...(scoreDelta() as Record<string, unknown>),
        previousCappedBy: 'security',
        currentCappedBy: 'unit',
      }),
    });
    render(<TodayPage api={apiClient()} qa={moved} projectId="p1" />);
    const changed = await screen.findByTestId('today-changed');
    expect(changed).toHaveTextContent('The limiter changed: security → unit');
  });

  it('renders nothing to wait for and nobody to filter by', async () => {
    render(
      <TodayPage
        api={apiClient()}
        qa={qaClient({ getDecisions: vi.fn().mockResolvedValue([]) })}
        projectId="p1"
      />,
    );
    // No roster, so no owner chips beyond "Everyone" — a chip for a name nobody
    // is waiting on is a filter that answers nothing.
    await screen.findByTestId('today-waiting-none');
    expect(screen.getByRole('button', { name: 'Everyone' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'reviewer-1' })).not.toBeInTheDocument();
  });

  it('counts a verdict recorded by nobody as nobody', async () => {
    // An unnamed owner is a verdict that happened without a name, and hiding it
    // would flatter the list. It is counted, and it is last.
    render(
      <TodayPage
        api={apiClient()}
        qa={qaClient({
          getTimeline: vi
            .fn()
            .mockResolvedValue(timeline({ owners: [{ ownerId: null, decided: 2 }] })),
        })}
        projectId="p1"
      />,
    );
    const decided = await screen.findByTestId('today-decided');
    expect(decided).toHaveTextContent('unnamed');
  });
});
