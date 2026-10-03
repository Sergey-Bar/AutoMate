import { describe, expect, it } from 'vitest';
import { QaScoreSchema, type QaScore } from '@automate/shared-contracts';
import { QaApiError, createQaClient } from './qa-client.js';
import { QaGapsResponseSchema } from './qa.js';

/**
 * The command center's data layer.
 *
 * Two properties are load-bearing and both are about **not trusting the server
 * blindly and not re-deriving what the server decided**:
 *
 *  1. A response that does not match the contract is refused before a screen sees
 *     it. A client that renders whatever arrived will one day render a score with no
 *     limiter beside it, which is the number this whole product exists to make
 *     trustworthy.
 *  2. The client never re-ranks. The server ranked the gap queue with the weights it
 *     used; a second sorter is a second authority about the same number.
 */

const AT = '2026-10-02T00:00:00.000Z';

const cell = (
  category: string,
  surface: string,
  score: number,
  extra: Record<string, unknown> = {},
) => ({
  key: `${category}:${surface}`,
  category,
  surface,
  score,
  presence: score > 0 ? 1 : 0,
  depth: score,
  stability: 1,
  signal: 1,
  excluded: false,
  inputs: {
    executedTests: 10,
    targetTests: 20,
    surfaceCoverage: null,
    coverageTarget: null,
    flakeRate: 0,
    failedFingerprints: [],
    flakyFingerprints: [],
    hollowFingerprints: [],
    qualifyingRuns: 1,
    ...extra,
  },
});

const score: QaScore = QaScoreSchema.parse({
  projectId: 'project-1',
  at: AT,
  total: 62,
  cappedBy: 'security',
  cappingValue: 0,
  cells: [
    ...(['unit', 'integration', 'e2e', 'performance', 'security'] as const).flatMap((category) =>
      (['backend', 'frontend', 'platform'] as const).map((surface) => cell(category, surface, 0.8)),
    ),
  ],
  surfaces: { backend: 0.8, frontend: 0.8, platform: 0.8 },
  rows: [
    ...(['unit', 'integration', 'e2e', 'performance', 'security'] as const).map((id) => ({
      id,
      value: 0.8,
      weight: 0.18,
      includedCells: 3,
    })),
    { id: 'pyramid-shape' as const, value: 0.9, weight: 0.1, includedCells: 15 },
  ],
  pyramid: {
    observed: { unit: 0.7, integration: 0.2, e2e: 0.1 },
    target: { unit: 0.7, integration: 0.2, e2e: 0.1 },
    declaredTarget: null,
    shape: 1,
    drift: 0,
  },
  gaps: [],
  findings: [],
  provenance: {
    projectId: 'project-1',
    detectorVersion: 1,
    runsRead: 3,
    resultsRead: 120,
    infraFailedRuns: [],
    infraFailedRate: 0,
    quarantinedFingerprints: [],
    outcomeCounts: { passed: 120 },
  },
  weights: {
    cell: { depth: 0.4, stability: 0.4, signal: 0.2 },
    rows: { unit: 0.18, integration: 0.18, e2e: 0.18, performance: 0.18, security: 0.18 },
    pyramid: 0.1,
  },
});

function respondWith(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('a response is validated before a screen sees it', () => {
  it('accepts a contract-valid score', async () => {
    const { impl } = respondWith(score);
    await expect(createQaClient('', impl).getScore('project-1')).resolves.toMatchObject({
      total: 62,
    });
  });

  it('refuses a score with no limiter rather than rendering a bare number', async () => {
    const { declaredTarget: _drop, ...pyramid } = score.pyramid;
    const stripped = { ...score, cappedBy: undefined };
    void pyramid;
    const { impl } = respondWith(stripped);
    // This is the assertion the whole command center exists to make possible: a
    // weighted geometric total cannot be diagnosed on its own, so a payload that
    // omits the limiter never becomes a number on a screen.
    await expect(createQaClient('', impl).getScore('project-1')).rejects.toThrow(QaApiError);
  });

  it('refuses a matrix that is not 6×3', async () => {
    const { impl } = respondWith({ ...score, cells: score.cells.slice(0, 10) });
    const failure = await createQaClient('', impl)
      .getScore('project-1')
      .catch((error: unknown) => error);
    // The shape failure lives in `detail`, not in `message`: `message` says which
    // request failed and `detail` says what was wrong with the answer, and a client
    // that merged them would report "API answered 200" for a malformed body — a
    // statement that is true and useless.
    expect(failure).toBeInstanceOf(QaApiError);
    expect((failure as QaApiError).detail).toMatch(/cells/u);
  });

  it("surfaces the server's own error text, not a generic one", async () => {
    const { impl } = respondWith(
      { error: { code: 'CONFLICT', message: 'a project with that slug is already registered' } },
      409,
    );
    const failure = await createQaClient('', impl)
      .getScore('project-1')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(QaApiError);
    expect((failure as QaApiError).status).toBe(409);
    expect((failure as QaApiError).detail).toContain('already registered');
  });
});

describe('the client escapes every id it interpolates', () => {
  it('cannot be made to construct a path', async () => {
    const { calls, impl } = respondWith(score);
    await createQaClient('', impl)
      .getScore('../../admin')
      .catch(() => undefined);
    expect(calls[0]).toBe('/api/v1/projects/..%2F..%2Fadmin/qa/score');
  });

  it('sends the session cookie on every call', async () => {
    // The command center is behind the same session as the rest of the dashboard;
    // a client that forgot `credentials` would fail only for the reader whose
    // session it did not send.
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const impl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(score), { status: 200 });
    }) as unknown as typeof fetch;
    await createQaClient('', impl).getScore('project-1');
    expect(calls[0]?.init?.credentials as string | undefined).toBe('include');
  });
});

describe('starting a run sends a command id and nothing executable', () => {
  it('has no field that could carry an argv', async () => {
    const calls: Array<{ body: string | undefined }> = [];
    const impl = (async (_input: string | URL, init?: RequestInit) => {
      calls.push({ body: String(init?.body) });
      return new Response(JSON.stringify({ runId: 'run-1', jobId: 'job-1', phase: 'queued' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    await createQaClient('', impl).startRun('project-1', 'node.test', 'key-1');
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['commandId']).toBe('node.test');
    expect(body['idempotencyKey']).toBe('key-1');
    expect(Object.keys(body).sort()).toEqual(['commandId', 'idempotencyKey']);
    // A browser has no way to spawn anything, but a copy-paste button built from
    // this body would hand an operator a string they could run elsewhere.
    expect(calls[0]?.body).not.toMatch(/argv|shell/iu);
  });
});

describe('every method of the client reaches its own endpoint', () => {
  // Each method is one line that calls a URL and parses a schema. Individually they
  // look like plumbing; collectively they are the whole surface a screen can reach,
  // and an untested one is a method that either points at the wrong route or has a
  // schema nobody has checked.
  const calls: string[] = [];
  let body: unknown = score;
  const impl = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

  const client = () => createQaClient('', impl);

  it('lists projects and unwraps the array', async () => {
    body = {
      projects: [
        {
          id: 'p1',
          workspaceId: 'w',
          name: 'A',
          slug: 'a',
          repoPath: null,
          detectorVersion: 1,
          createdAt: AT,
        },
      ],
    };
    await expect(client().listProjects()).resolves.toHaveLength(1);
    expect(calls.pop()).toBe('/api/v1/projects');
  });

  it('reads one project with its commands', async () => {
    body = {
      project: {
        id: 'p1',
        workspaceId: 'w',
        name: 'A',
        slug: 'a',
        repoPath: '/r',
        detectorVersion: 1,
        createdAt: AT,
      },
      commands: [
        {
          id: 'node.test',
          argv: ['pnpm', 'test'],
          category: 'unit',
          evidence: 'package.json:1',
          confidence: 0.9,
          artifactGlobs: [],
          env: [],
        },
      ],
    };
    await expect(client().getProject('p1')).resolves.toMatchObject({
      commands: [{ argv: ['pnpm', 'test'] }],
    });
    expect(calls.pop()).toBe('/api/v1/projects/p1');
  });

  it('reads hollow, flaky and structure', async () => {
    body = { cells: [{ cell: 'unit:backend', hollowFingerprints: ['h1'], signal: 0 }] };
    await expect(client().getHollow('p1')).resolves.toMatchObject({
      cells: [{ cell: 'unit:backend' }],
    });
    expect(calls.pop()).toBe('/api/v1/projects/p1/qa/hollow');

    body = {
      cells: [{ cell: 'unit:backend', flakyFingerprints: ['f1'], flakeRate: 0.1, stability: 0.9 }],
    };
    await expect(client().getFlaky('p1')).resolves.toMatchObject({
      cells: [{ flakyFingerprints: ['f1'] }],
    });
    expect(calls.pop()).toBe('/api/v1/projects/p1/qa/flaky');

    body = {
      findings: [{ kind: 'dominant_cell', statement: 's', cells: ['e2e:backend'], impact: 0.1 }],
    };
    await expect(client().getStructure('p1')).resolves.toMatchObject({
      findings: [{ kind: 'dominant_cell' }],
    });
    expect(calls.pop()).toBe('/api/v1/projects/p1/qa/structure');
  });

  it('asks the copilot', async () => {
    body = {
      projectId: 'p1',
      derivedFrom: { at: AT, total: 0, cappedBy: 'security' },
      suggestions: [],
      notSuggested: [],
      coveredCategories: ['unit'],
    };
    await expect(client().askCopilot('p1', 'what is wrong?')).resolves.toMatchObject({
      coveredCategories: ['unit'],
    });
    expect(calls.pop()).toBe('/api/v1/projects/p1/copilot/answer');
  });

  it('rejects a copilot answer whose suggestion cites nothing', async () => {
    // The hard rule, enforced at the boundary the browser crosses. A client that
    // accepted it would render a confident sentence with nothing behind it.
    body = {
      projectId: 'p1',
      derivedFrom: { at: AT, total: 0, cappedBy: 'security' },
      suggestions: [
        {
          kind: 'add-missing-suite',
          what: 'a',
          why: 'b',
          target: 'unit:backend',
          impact: -1,
          evidence: [],
          overrides: {},
          confidence: 1,
        },
      ],
      notSuggested: [],
      coveredCategories: ['unit'],
    };
    await expect(client().askCopilot('p1', 'what is wrong?')).rejects.toThrow(QaApiError);
  });
});
describe('the gap queue keeps the order the server chose', () => {
  const gaps = {
    gaps: [
      {
        cell: 'security:backend',
        category: 'security',
        surface: 'backend',
        current: 0,
        potential: 0.4,
        cheapestClosure: 'No suite.',
      },
      {
        cell: 'unit:frontend',
        category: 'unit',
        surface: 'frontend',
        current: 0.2,
        potential: 0.1,
        cheapestClosure: 'Add tests.',
      },
    ],
    cappedBy: 'security',
  };

  it('accepts the order as sent', async () => {
    const { impl } = respondWith(gaps);
    const response = await createQaClient('', impl).getGaps('project-1');
    // Ascending by `potential` would reverse these. The client does not re-sort:
    // a second sorter is a second authority about the same number.
    expect(response.gaps.map((gap) => gap.cell)).toEqual(['security:backend', 'unit:frontend']);
  });

  it('refuses a queue with no limiter', async () => {
    const unused = respondWith({ gaps: gaps.gaps });
    void unused;
    // Same clause as the score. A gap list with no capping row cannot say whether
    // the reader is looking at everything.
    expect(QaGapsResponseSchema.safeParse({ gaps: gaps.gaps }).success).toBe(false);
  });
});
