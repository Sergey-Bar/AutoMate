import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import * as schema from '@automate/db';
import { createErrorBoundary } from '../errors/boundary.js';
import { createProjectsRoutes } from './projects.js';
import { InMemoryDecisionStore } from '../execution/in-memory-decision-store.js';
import type { DecisionStore } from '../execution/decision-store.js';
import { DECISION_TIMELINE_WEEKS } from '@automate/db';
import { DecisionTimelineSchema } from '@automate/shared-contracts';
import { literalView } from '@automate/projects';
import type { RepositoryView } from '@automate/projects';
import { CopilotAnswerSchema, QaScoreSchema, ScoreDeltaSchema } from '@automate/shared-contracts';

/**
 * The registry and the score, over a real migrated database.
 *
 * PGlite rather than a mock: the claims under test are about **foreign keys** and
 * **columns that must exist** (`runs.project_id` resolving to a registry row,
 * `projects.profile` carrying a detector version), and a mocked repository cannot
 * assert either. Migration 0023's pre-audit also raises rather than repairs, which
 * is only observable against a real graph.
 */

const NODE_REPO: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({
    name: 'svc',
    scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
    devDependencies: { vitest: '^4.1.5', '@playwright/test': '^1.63.0' },
  }),
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
};

/**
 * The migration graph read straight from the journal, exactly as
 * `routes/execution.test.ts` does it.
 *
 * Copied rather than imported: that helper lives in `tests/integration`, which is a
 * different package with its own dependency graph, and making `apps/api` a
 * workspace devDependency of the integration suite so it could borrow four lines
 * would be a dependency in the wrong direction. The graph is read from the same file
 * both packages read, so there is still one source of truth.
 */
function migrationSql(): string {
  const drizzleDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/db/drizzle',
  );
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  // Each file is split on its own statement breakpoints and rejoined with a
  // semicolon, exactly as `routes/execution.test.ts` does it. Joining the files
  // *with* a literal `--> statement-breakpoint` instead — the obvious reading of
  // the format — produces `--> ;` where a file already ended in one, which PGlite
  // rejects at position 4 of the whole script.
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

async function migrated() {
  const client = new PGlite();
  await client.exec(migrationSql());
  return { client, db: drizzle(client, { schema }) };
}

/**
 * A response is one object carrying the array its contract declares under `cells`.
 *
 * Asserted inline rather than through a schema imported from the web client: the
 * client owns its copy of the shape, and a server test that reached across the
 * workspace to read it would fail for the wrong reason when the two disagreed.
 */
function hasCells(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && Array.isArray((body as { cells?: unknown }).cells)
  );
}

/** Same for the structure endpoint, whose payload is `findings`. */
function hasFindings(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { findings?: unknown }).findings)
  );
}

/** The routes behind the real error boundary, so a thrown DomainError becomes a response. */
function mounted(routes: Hono): Hono {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  return new Hono().onError(onError).route('/', routes);
}

function harness(
  db: ReturnType<typeof drizzle<typeof schema>>,
  view: RepositoryView = literalView(NODE_REPO),
  started: string[] = [],
  decisionStore?: DecisionStore,
) {
  return mounted(
    createProjectsRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      viewFor: () => view,
      ...(decisionStore === undefined ? {} : { decisionStore }),
      startRun: async (input) => {
        started.push(input.commandId);
        return { runId: `run-${started.length}`, jobId: `job-${started.length}`, phase: 'queued' };
      },
    }),
  );
}

/** The same harness with a decision store wired in, which the plain one does not have. */
function harnessWithDecisions(
  db: ReturnType<typeof drizzle<typeof schema>>,
  decisionStore: DecisionStore,
) {
  return harness(db, literalView(NODE_REPO), [], decisionStore);
}

const post = (app: ReturnType<typeof harness>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('registering a repository', () => {
  it('detects the ecosystem, the framework and the runnable command', async () => {
    const { client, db } = await migrated();
    try {
      const response = await post(harness(db), '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        project: { detectorVersion: number; profile: { ecosystem: string; commands: unknown[] } };
        commands: Array<{ id: string; argv: string[] }>;
      };
      expect(body.project.profile.ecosystem).toBe('node');
      expect(body.project.detectorVersion).toBe(1);
      expect(body.commands.length).toBeGreaterThan(0);
      // argv, never a string — the shape that makes a shell unavailable.
      expect(Array.isArray(body.commands[0]?.argv)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('lets a checked-in automate.config.json override the detection', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(
        db,
        literalView({
          ...NODE_REPO,
          'automate.config.json': JSON.stringify({
            version: 1,
            commands: { unit: ['pytest', '-q', 'tests/unit'] },
          }),
        }),
      );
      const response = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const body = (await response.json()) as {
        project: { profile: { commands: Array<{ argv: string[]; category: string }> } };
      };
      const unit = body.project.profile.commands.find((command) => command.category === 'unit');
      expect(unit?.argv).toEqual(['pytest', '-q', 'tests/unit']);
    } finally {
      await client.close();
    }
  });

  it('refuses a slug that could escape a directory or a shell', async () => {
    const { client, db } = await migrated();
    try {
      const response = await post(harness(db), '/api/v1/projects', {
        name: 'Evil',
        slug: '../../etc/passwd',
        repoPath: '/repos/evil',
      });
      expect(response.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('refuses a second project with the same slug', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      await post(app, '/api/v1/projects', { name: 'A', slug: 'svc', repoPath: '/repos/a' });
      const second = await post(app, '/api/v1/projects', {
        name: 'B',
        slug: 'svc',
        repoPath: '/repos/b',
      });
      // 409, and not a silent overwrite: two repositories sharing a slug would make
      // every per-project rollup ambiguous.
      expect(second.status).toBe(409);
    } finally {
      await client.close();
    }
  });

  it('reports an unreadable repository as a 4xx rather than registering a row', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db, {
        paths: async () => [],
        read: async () => {
          throw new Error('EACCES');
        },
      });
      const response = await post(app, '/api/v1/projects', {
        name: 'Broken',
        slug: 'broken',
        repoPath: '/repos/broken',
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      const listed = await app.request('/api/v1/projects');
      const body = (await listed.json()) as { projects: unknown[] };
      // A row that cannot be detected is a row every later command fails against.
      expect(body.projects).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});

describe('starting a run takes a command id, never an executable', () => {
  it('starts the command the profile declares', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db, literalView(NODE_REPO), []);
      const created = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as {
        project: { id: string; profile: { commands: Array<{ id: string }> } };
      };
      const started: Array<{ commandId: string; command?: unknown }> = [];
      const runnable = mounted(
        createProjectsRoutes({
          db: db as never,
          workspaceId: 'ws-1',
          viewFor: () => literalView(NODE_REPO),
          startRun: async (input) => {
            started.push(input);
            return { runId: 'run-1', jobId: 'job-1', phase: 'queued' };
          },
        }),
      );
      const response = await post(runnable, `/api/v1/projects/${project.id}/run.start`, {
        commandId: 'node.test',
        idempotencyKey: 'k1',
      });
      expect(response.status).toBe(202);
      expect(started).toHaveLength(1);
      // **The argv travels with the command.** A job spec carrying only the id
      // leaves the runner with nothing to spawn: it fell back to the Playwright
      // smoke fixture, which is a green suite that tested nobody's code. The
      // profile is still the only authority — this is the same object `run.start`
      // validated the id against, not a second resolution.
      const command = started[0]?.command as { id: string; argv: string[] } | undefined;
      expect(command?.id).toBe('node.test');
      expect(command?.argv.length).toBeGreaterThan(1);
      expect(['node', 'pnpm', 'npm', 'yarn', 'npx', 'make']).toContain(command?.argv[0]);
    } finally {
      await client.close();
    }
  });

  it('refuses an unknown command id rather than running a nearby one', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const created = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const started: string[] = [];
      const app2 = mounted(
        createProjectsRoutes({
          db: db as never,
          workspaceId: 'ws-1',
          viewFor: () => literalView(NODE_REPO),
          startRun: async (input) => {
            started.push(input.commandId);
            return { runId: 'r', jobId: 'j', phase: 'queued' };
          },
        }),
      );
      const response = await post(app2, `/api/v1/projects/${project.id}/run.start`, {
        commandId: 'node.test.e2e.deploy',
        idempotencyKey: 'k1',
      });
      expect(response.status).toBe(404);
      expect(started).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('requires an idempotency key, so a double tap is one run', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const created = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const response = await post(app, `/api/v1/projects/${project.id}/run.start`, {
        commandId: 'node.test',
      });
      expect(response.status).toBe(400);
    } finally {
      await client.close();
    }
  });
});

describe('the score is served with the term that limited it', () => {
  it('returns a schema-valid score whose capping row is named', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const created = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as { project: { id: string } };

      const response = await app.request(`/api/v1/projects/${project.id}/qa/score`);
      const body = (await response.json()) as unknown;

      // The schema, not a hand-written assertion: `cappedBy` and `cappingValue`
      // are required, so a score without them cannot be served at all.
      expect(QaScoreSchema.safeParse(body).success).toBe(true);
      const score = body as { total: number; cappedBy: string; cells: unknown[] };
      expect(score.total).toBe(0);
      expect(score.cappedBy).toBeTypeOf('string');
      expect(score.cells).toHaveLength(15);
    } finally {
      await client.close();
    }
  });

  it('reports zero infra failures when nothing has run', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const created = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const response = await app.request(`/api/v1/projects/${project.id}/qa/score`);
      const body = (await response.json()) as {
        provenance: { infraFailedRate: number; runsRead: number };
      };
      expect(body.provenance.runsRead).toBe(0);
      expect(body.provenance.infraFailedRate).toBe(0);
    } finally {
      await client.close();
    }
  });

  it('serves the gap queue and names what would close each gap', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const created = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const response = await app.request(`/api/v1/projects/${project.id}/qa/gaps`);
      const body = (await response.json()) as {
        gaps: Array<{ cell: string; cheapestClosure: string; potential: number }>;
      };
      expect(body.gaps.length).toBe(15);
      for (const gap of body.gaps) {
        expect(gap.cheapestClosure.length).toBeGreaterThan(0);
        expect(gap.cell).toMatch(
          /^(unit|integration|e2e|performance|security):(backend|frontend|platform)$/u,
        );
      }
    } finally {
      await client.close();
    }
  });

  it('404s a project that does not exist rather than scoring an empty install', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const response = await app.request(
        '/api/v1/projects/00000000-0000-4000-8000-00000000dead/qa/score',
      );
      expect(response.status).toBe(404);
    } finally {
      await client.close();
    }
  });
});

describe('stopping a run records why', () => {
  it('requires a reason, because an interruption with none is indistinguishable from a crash', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const response = await post(app, '/api/v1/runs/run-1/stop', {});
      expect(response.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('404s a run that does not exist', async () => {
    // A well-formed uuid that names no row. A *malformed* id is a different
    // answer: `runs.id` is a uuid column, so `'missing'` is rejected by
    // PostgreSQL as `22P02` and correctly surfaces as a 400 rather than a 404 —
    // the client sent a broken request, not a request for something absent.
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const response = await post(app, '/api/v1/runs/00000000-0000-4000-8000-00000000dead/stop', {
        reason: 'operator changed their mind',
      });
      expect(response.status).toBe(404);
    } finally {
      await client.close();
    }
  });
});

describe('every remaining endpoint of the group is reachable and validated', () => {
  /**
   * The endpoints a reader reaches from the sidebar.
   *
   * Twelve routes and eight of them were untested, which means eight could return a
   * body no client had ever parsed. Each one is exercised here for the property that
   * matters rather than for a status code: **it answers with the shape the contract
   * declares**, because a route that answers 200 with an unvalidated body is the
   * same defect as an adapter that ingests a malformed artifact.
   */
  async function registered() {
    const { client, db } = await migrated();
    const app = harness(db);
    const created = await post(app, '/api/v1/projects', {
      name: 'Service',
      slug: 'svc',
      repoPath: '/repos/svc',
    });
    const { project } = (await created.json()) as { project: { id: string } };
    return { client, db, app, projectId: project.id };
  }

  it('lists a project and its commands', async () => {
    const { client, app, projectId } = await registered();
    try {
      const detail = await app.request(`/api/v1/projects/${projectId}`);
      const body = (await detail.json()) as { project: { slug: string }; commands: unknown[] };
      expect(body.project.slug).toBe('svc');
      expect(body.commands.length).toBeGreaterThan(0);

      const commands = await app.request(`/api/v1/projects/${projectId}/commands`);
      expect(((await commands.json()) as { commands: unknown[] }).commands.length).toBeGreaterThan(
        0,
      );

      const list = await app.request('/api/v1/projects');
      expect(((await list.json()) as { projects: unknown[] }).projects).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it('re-runs detection and replaces the stored profile', async () => {
    const { client, app, projectId } = await registered();
    try {
      const before = await app.request(`/api/v1/projects/${projectId}`);
      const beforeBody = (await before.json()) as { project: { detectorVersion: number } };

      const response = await app.request(`/api/v1/projects/${projectId}/detect`, {
        method: 'POST',
      });
      // **200, not 422.** This used to answer 422 for every project, always, because
      // it re-registered the row with its own slug and collided with itself — and it
      // is the button a reader presses after changing their `package.json`.
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        profile: { ecosystem: string | null };
        evidence: string[];
      };
      expect(body.profile.ecosystem).toBe('node');
      expect(body.evidence.length).toBeGreaterThan(0);
      expect(beforeBody.project.detectorVersion).toBe(1);

      // And the stored row now carries the refreshed profile, so a later read agrees.
      const after = await app.request(`/api/v1/projects/${projectId}`);
      expect(
        ((await after.json()) as { project: { detectorVersion: number } }).project.detectorVersion,
      ).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('refuses to re-detect a project whose row has no repository path', async () => {
    const { client, db, app, projectId } = await registered();
    try {
      // A row migrated in from before the column existed, or one whose path was
      // cleared. Re-running detection would otherwise read `.` — the runner's own
      // working directory — and report whatever manifests happened to be there as this
      // customer's project. The refusal is the whole value of this branch.
      await db
        .update(schema.projects)
        .set({ repoPath: null })
        .where(eq(schema.projects.id, projectId));

      const response = await app.request(`/api/v1/projects/${projectId}/detect`, {
        method: 'POST',
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/no repository path/iu);
    } finally {
      await client.close();
    }
  });

  it('refuses a diff whose two ends read the same rows', async () => {
    const { client, app, projectId } = await registered();
    try {
      // The project has never run, so both readings read no rows and nothing moved.
      // **This used to answer 200 with an empty `contributions` array**, and the
      // comment beside it called that "a true answer rather than an error" — which is
      // what let the defect survive review. It is not an answer: nothing was compared.
      // A `ScoreDelta` whose every contribution must cite evidence would otherwise
      // have rendered a confident, sourced, wrong diff.
      const response = await app.request(
        `/api/v1/projects/${projectId}/qa/score/diff?since=2026-10-01T00:00:00.000Z`,
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/nothing to nothing/iu);
    } finally {
      await client.close();
    }
  });

  it('serves a real diff once `since` selects a different window', async () => {
    const { client, db, app, projectId } = await registered();
    try {
      // Two runs, one either side of `since`. The first observes a passing security
      // test; the second observes it failing. Before this fix the two reads were
      // unfiltered, so both ends saw both runs and the diff was empty — which the
      // endpoint's own comment called "a true answer rather than an error".
      //
      // **Dated in 2020, deliberately.** The current reading is taken at
      // `new Date().toISOString()`, so any fixture near "today" makes this test
      // correct until the calendar moves past it — and a test that expires is a
      // test that was lying about the time it proved something.
      await client.query(
        `INSERT INTO runs (id, workspace_id, project_id, started_at, phase, outcome)
         VALUES
           ('00000000-0000-4000-8000-00000000bbb1', 'ws-1', $1, '2020-01-01T00:00:00.000Z', 'complete', 'passed'),
           ('00000000-0000-4000-8000-00000000bbb2', 'ws-1', $1, '2020-06-01T00:00:00.000Z', 'complete', 'failed')`,
        [projectId],
      );
      const result = (runId: string, status: 'passed' | 'failed') => ({
        identity: { runId, projectId },
        metadata: {
          fingerprint: 'zap/auth-check',
          category: 'security',
          surface: 'backend',
          assertionCount: 2,
          trivialAssertionCount: 0,
          touchedIo: true,
        },
        provenance: { commitSha: 'c1' },
        attempts: [{ testId: 'zap/auth-check', status, durationMs: 25 }],
      });
      await db.insert(schema.canonicalRunResults).values([
        {
          workspaceId: 'ws-1',
          runId: '00000000-0000-4000-8000-00000000bbb1',
          fingerprint: 'zap/auth-check',
          result: result('00000000-0000-4000-8000-00000000bbb1', 'passed'),
        },
        {
          workspaceId: 'ws-1',
          runId: '00000000-0000-4000-8000-00000000bbb2',
          fingerprint: 'zap/auth-check',
          result: result('00000000-0000-4000-8000-00000000bbb2', 'failed'),
        },
      ]);

      const response = await app.request(
        `/api/v1/projects/${projectId}/qa/score/diff?since=2020-03-01T00:00:00.000Z`,
      );
      expect(response.status).toBe(200);
      const delta = ScoreDeltaSchema.parse(await response.json());
      expect(delta.projectId).toBe(projectId);
      expect(delta.from).toBe('2020-03-01T00:00:00.000Z');
      // **Non-empty, and every contribution cites a row.** This is what the endpoint
      // could not produce before: a window that actually advances.
      expect(delta.contributions.length).toBeGreaterThan(0);
      for (const contribution of delta.contributions) {
        expect(contribution.evidence.length, contribution.cause).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
    }
  });

  it('refuses a diff with no `since`, because an instant is the only anchor there is', async () => {
    const { client, app, projectId } = await registered();
    try {
      // There is no stored score to diff against, and that is deliberate — a
      // `health_scores` table would be a fourth `no-second-authority` number. So the
      // caller names the instant to recompute from, and omitting it would mean guessing
      // one.
      expect((await app.request(`/api/v1/projects/${projectId}/qa/score/diff`)).status).toBe(400);
      expect(
        (await app.request(`/api/v1/projects/${projectId}/qa/score/diff?since=yesterday`)).status,
      ).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('serves hollow, flaky and structure as their declared shapes', async () => {
    const { client, app, projectId } = await registered();
    try {
      const hollow = await app.request(`/api/v1/projects/${projectId}/qa/hollow`);
      expect(
        hasCells(await hollow.json()),
        'a client that cannot parse /qa/hollow has a screen that renders nothing',
      ).toBe(true);

      const flaky = await app.request(`/api/v1/projects/${projectId}/qa/flaky`);
      expect(hasCells(await flaky.json())).toBe(true);

      const structure = await app.request(`/api/v1/projects/${projectId}/qa/structure`);
      expect(hasFindings(await structure.json())).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('answers the copilot with a schema-valid, evidence-bearing set of suggestions', async () => {
    const { client, app, projectId } = await registered();
    try {
      const response = await post(app, `/api/v1/projects/${projectId}/copilot/answer`, {
        question: 'what is wrong?',
      });
      const body = (await response.json()) as unknown;
      expect(CopilotAnswerSchema.safeParse(body).success).toBe(true);
      const answer = body as {
        suggestions: Array<{ evidence: unknown[] }>;
        derivedFrom: { cappedBy: string };
      };
      // Asserted through the parsed body, not through the schema: the schema's
      // `.min(1)` is the rule and this is the consequence of it.
      expect(answer.suggestions.length).toBeGreaterThan(0);
      for (const suggestion of answer.suggestions) {
        expect(suggestion.evidence.length).toBeGreaterThan(0);
      }
      expect(answer.derivedFrom.cappedBy).toBeTypeOf('string');
    } finally {
      await client.close();
    }
  });

  it('rejects a copilot question that is not a question', async () => {
    const { client, app, projectId } = await registered();
    try {
      expect(
        (await post(app, `/api/v1/projects/${projectId}/copilot/answer`, { question: '' })).status,
      ).toBe(400);
      const long = await post(app, `/api/v1/projects/${projectId}/copilot/answer`, {
        question: 'x'.repeat(501),
      });
      expect(long.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('rejects a run.start whose body is not JSON, rather than reporting a server fault', async () => {
    const { client, app, projectId } = await registered();
    try {
      // `context.req.json()` **rejects** on a malformed body. A route that only
      // throws `DomainError` would surface that rejection as a 500 — telling an
      // operator their request was our fault when they sent one byte of punctuation
      // short of JSON.
      const response = await app.request(`/api/v1/projects/${projectId}/run.start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      });
      expect(response.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('refuses a config override that is not valid JSON, by name', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(
        db,
        literalView({ ...NODE_REPO, 'automate.config.json': '{ "version": 1, ' }),
      );
      // A customer with one missing brace must be told **which file** to fix. The
      // alternative — treating it as absent and silently falling back to detection —
      // would make the override they wrote look like it had been honoured.
      const response = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('automate.config.json');
    } finally {
      await client.close();
    }
  });

  it('registers a repository no detector recognises, with no proposal to show', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db, literalView({ 'README.md': '# just words\n' }));
      const response = await post(app, '/api/v1/projects', {
        name: 'Docs',
        slug: 'docs',
        repoPath: '/repos/docs',
      });
      // Registered, not refused: the row is what an operator then attaches a
      // **declared** command to. Refusing it would make the only way to run a suite
      // the detector cannot recognise "no row at all".
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        project: { profile: { ecosystem: string | null } };
        commands: unknown[];
      };
      expect(body.project.profile.ecosystem).toBeNull();
      expect(body.commands).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('rejects a project body that is not one', async () => {
    const { client, app } = await registered();
    try {
      for (const body of [{}, { name: 'x' }, { name: 'x', slug: 'y' }]) {
        expect((await post(app, '/api/v1/projects', body)).status, JSON.stringify(body)).toBe(400);
      }
      const malformed = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      });
      expect(malformed.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('404s a run.start on a project that does not exist, rather than starting something', async () => {
    const { client } = await registered();
    try {
      const started: string[] = [];
      const app2 = mounted(
        createProjectsRoutes({
          db: drizzle(client, { schema }) as never,
          workspaceId: 'ws-1',
          viewFor: () => literalView(NODE_REPO),
          startRun: async (input) => {
            started.push(input.commandId);
            return { runId: 'r', jobId: 'j', phase: 'queued' };
          },
        }),
      );
      const response = await post(
        app2,
        '/api/v1/projects/00000000-0000-4000-8000-00000000dead/run.start',
        {
          commandId: 'node.test',
          idempotencyKey: 'k1',
        },
      );
      expect(response.status).toBe(404);
      expect(started).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

/**
 * `PATCH /projects/:id` — the profile edit the documentation site already
 * promised, and that nothing served.
 *
 * **What the tests pin is the merge rule, not the endpoint's existence.** An edit
 * API with its own merge would be two rules, and the one nobody reads would decide
 * what a customer's project runs. So every assertion here is about *which keys
 * changed* and *which fell through* — including the refusal of an empty body,
 * which is the case where "the edit succeeded" and "nothing happened" would
 * otherwise be the same answer.
 */
describe('editing a stored profile', () => {
  const patch = (app: ReturnType<typeof harness>, id: string, body: unknown) =>
    app.request(`/api/v1/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function registered(db: ReturnType<typeof drizzle<typeof schema>>) {
    const app = harness(db);
    const created = await post(app, '/api/v1/projects', {
      name: 'Service',
      slug: 'svc',
      repoPath: '/repos/svc',
    });
    return (await created.json()) as {
      project: { id: string; profile: { commands: Array<{ id: string; category: string }> } };
      commands: Array<{ id: string }>;
    };
  }

  it('replaces the command the detector named, and returns what can now be run', async () => {
    const { client, db } = await migrated();
    try {
      const { project } = await registered(db);
      // A detector that named the wrong unit command used to leave
      // `automate.config.json` as the only way to correct it — an operator with no
      // shell and no write access had none at all.
      const response = await patch(harness(db), project.id, {
        commands: { unit: ['pytest', '-q', 'tests/unit'] },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        project: { profile: { commands: Array<{ id: string; argv: string[]; category: string }> } };
        commands: Array<{ id: string; argv: string[]; category: string }>;
      };
      const declared = body.commands.find((command) => command.category === 'unit');
      // argv, never a string — the same shape the detector produces, because the
      // edit is an override and not a second way to name an executable.
      expect(declared?.argv).toEqual(['pytest', '-q', 'tests/unit']);
      // And the e2e command the detector found is **kept**: an edit names the keys
      // it changes, and the rest fall through to what was stored.
      expect(body.commands.some((command) => command.category === 'e2e')).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('replaces, rather than appends to, the command for the category it names', async () => {
    // A detector that named `pnpm vitest run` and an operator who edited it to
    // `vitest run` must end with one unit command. An append would run the suite
    // they said not to run — the same reason `mergeConfig` replaces.
    const { client, db } = await migrated();
    try {
      const { project } = await registered(db);
      await patch(harness(db), project.id, { commands: { unit: ['vitest', 'run'] } });
      const app = harness(db);
      const read = await app.request(`/api/v1/projects/${project.id}`);
      const body = (await read.json()) as {
        commands: Array<{ category: string; argv: string[] }>;
      };
      expect(body.commands.filter((command) => command.category === 'unit')).toHaveLength(1);
      expect(body.commands.find((command) => command.category === 'unit')?.argv).toEqual([
        'vitest',
        'run',
      ]);
    } finally {
      await client.close();
    }
  });

  it('refuses a body that names no key, rather than answering success for a no-op', async () => {
    // "The edit succeeded" and "nothing happened" being the same response is how
    // an operator ends up believing a correction landed.
    const { client, db } = await migrated();
    try {
      const { project } = await registered(db);
      const response = await patch(harness(db), project.id, { version: 1 });
      // 400, because `updateProjectProfile` **throws** `INVALID_REQUEST_BODY`
      // rather than answering 200 for a no-op — and the boundary's mapping of that
      // code is 400, the same as the route's own schema rejection being 422. What
      // this assertion pins is the *refusal*, not the digit: an edit that changed
      // nothing must not read as success.
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain('at least one key');
    } finally {
      await client.close();
    }
  });

  it('refuses a body it does not understand, rather than applying part of it', async () => {
    const { client, db } = await migrated();
    try {
      const { project } = await registered(db);
      const response = await patch(harness(db), project.id, {
        commands: { nonsense: ['rm', '-rf', '/'] },
      });
      expect(response.status).toBe(422);
      // A partially-applied edit is worse than a refused one: the operator sees
      // success and a profile that is half what they asked for.
      const read = await harness(db).request(`/api/v1/projects/${project.id}`);
      const body = (await read.json()) as { commands: Array<{ id: string }> };
      expect(body.commands.length).toBeGreaterThan(0);
      expect(body.commands.every((command) => command.id !== 'node.unit.nonsense')).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('survives a re-detect that reads the repository again', async () => {
    // **The direction an edit has, and the honest one.** The repository is the
    // source, so a Re-detect re-reads it and the edit is gone until the file
    // catches up — the same direction a checked-in override has. A test that
    // asserted otherwise would be asserting a second authority.
    const { client, db } = await migrated();
    try {
      const { project } = await registered(db);
      await patch(harness(db), project.id, { commands: { unit: ['pytest', '-q', 'tests/unit'] } });
      const response = await post(harness(db), `/api/v1/projects/${project.id}/detect`, {});
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        profile: { commands: Array<{ category: string }> };
      };
      expect(body.profile.commands.some((command) => command.category === 'unit')).toBe(true);
      const read = await harness(db).request(`/api/v1/projects/${project.id}`);
      const after = (await read.json()) as { commands: Array<{ argv: string[] }> };
      expect(after.commands.some((command) => command.argv[0] === 'pytest')).toBe(false);
    } finally {
      await client.close();
    }
  });
});

/**
 * `GET /projects/:id/toolchain` — the probe's answer, for one project.
 *
 * **The endpoint that ends the client-side lie.** The cockpit used to carry a
 * ten-path list and *assume* the repository had those files, so "your stack" was
 * whatever the browser imagined. These tests assert the server's answer carries
 * evidence, because a detection without it is a row nobody can check.
 */
describe('probing a repository for its toolchain', () => {
  it('answers per tool with the evidence that proved it', async () => {
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const created = await post(app, '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const response = await app.request(`/api/v1/projects/${project.id}/toolchain`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        projectId: string;
        detections: Array<{ toolId: string; detected: boolean; evidence: string | null }>;
      };
      expect(body.projectId).toBe(project.id);
      // One row per catalogued tool: the probe answers for all of them rather
      // than a subset, so a screen can render the whole registry and let the
      // join decide what is missing.
      expect(body.detections.length).toBeGreaterThan(20);
      const vitest = body.detections.find((detection) => detection.toolId === 'vitest');
      expect(vitest?.detected).toBe(true);
      // **The evidence is a path in the fixture or the manifest entry that
      // declared it — never a claim.** A reader can check either, which is the
      // property the whole endpoint exists for.
      expect(vitest?.evidence).toMatch(/vitest/u);
      // And an undetected tool carries none at all — a fabricated path would be
      // a row nobody can check, which is worse than a missing row.
      const cypress = body.detections.find((detection) => detection.toolId === 'cypress');
      expect(cypress?.detected).toBe(false);
      expect(cypress?.evidence).toBeNull();
    } finally {
      await client.close();
    }
  });

  it('has no path-less project to probe, because registration refuses one', async () => {
    // **The invariant, asserted where it is enforced.** The toolchain route reads
    // `project.repoPath` without a null branch, and that is only correct while a
    // project without a path cannot be registered. This is the test that keeps it
    // correct: a schema change relaxing `repoPath` fails here rather than
    // producing a probe that cannot read anything.
    const { client, db } = await migrated();
    try {
      const app = harness(db);
      const created = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Pathless', slug: 'pathless' }),
      });
      // 400 is the boundary's own mapping of a schema failure here, and the
      // refusal is the assertion — not the digit.
      expect(created.status).toBe(400);
      const body = (await created.json()) as { error?: { message?: string } };
      expect(body.error?.message ?? '').toMatch(/repoPath|required|Invalid/i);
    } finally {
      await client.close();
    }
  });
});

/**
 * The decision loop — the route that makes the console a work queue.
 *
 * ## What these tests assert, and why it is not the route's existence
 *
 * A route that returns 200 proves the route exists. What matters is the four
 * properties the loop depends on: **a verdict is written and read back; a second
 * write for the same finding replaces rather than duplicates; a deferral with no
 * date is refused; and a verdict on one cell does not cover another.** The last
 * three are also pinned against both stores in `decision-store-parity.test.ts` —
 * these are the route-level proofs, where a wrong shape would be a 500 rather
 * than a silent duplicate.
 */
describe('recording a decision about a finding', () => {
  const FINDING = 'flaky-decision';

  /** A harness with a decision store wired in, plus a project to decide about. */
  async function withDecisions(): Promise<{
    app: ReturnType<typeof harness>;
    project: { id: string };
    client: { close: () => Promise<void> };
  }> {
    const { client, db } = await migrated();
    const store = new InMemoryDecisionStore();
    const created = await post(harnessWithDecisions(db, store), '/api/v1/projects', {
      name: 'Service',
      slug: 'svc',
      repoPath: '/repos/svc',
    });
    const { project } = (await created.json()) as { project: { id: string } };
    return {
      app: harnessWithDecisions(db, store),
      project,
      client: client as unknown as { close: () => Promise<void> },
    };
  }

  it('writes a verdict and reads it back', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const response = await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: 'e2e:frontend',
        verdict: 'accepted',
        ownerId: 'reviewer-1',
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        decision: { verdict: string; findingId: string };
      };
      expect(body.decision.verdict).toBe('accepted');
      expect(body.decision.findingId).toBe(FINDING);

      const read = await app.request(`/api/v1/projects/${project.id}/decisions`);
      const list = (await read.json()) as { decisions: Array<{ verdict: string }> };
      expect(list.decisions).toHaveLength(1);
      expect(list.decisions[0]?.verdict).toBe('accepted');
    } finally {
      await client.close();
    }
  });

  it('replaces a verdict for the same finding rather than adding a row', async () => {
    const { app, project, client } = await withDecisions();
    try {
      await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: 'e2e:frontend',
        verdict: 'open',
      });
      await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: 'e2e:frontend',
        verdict: 'fixed',
      });
      const read = await app.request(`/api/v1/projects/${project.id}/decisions`);
      const list = (await read.json()) as { decisions: Array<{ verdict: string }> };
      // **The loop's central invariant.** "What did I decide about this flake"
      // must have one answer, or the console reports the first one forever.
      expect(list.decisions).toHaveLength(1);
      expect(list.decisions[0]?.verdict).toBe('fixed');
    } finally {
      await client.close();
    }
  });

  it('keeps a verdict on one cell from covering another', async () => {
    const { app, project, client } = await withDecisions();
    try {
      await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: 'e2e:frontend',
        verdict: 'accepted',
      });
      await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: 'e2e:backend',
        verdict: 'open',
      });
      const read = await app.request(`/api/v1/projects/${project.id}/decisions`);
      const list = (await read.json()) as { decisions: Array<{ cell: string | null }> };
      // Two decisions about two different tests, not one verdict covering both.
      expect(list.decisions).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it('refuses a deferral with no date, and names the rule that refused it', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const response = await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: null,
        verdict: 'deferred',
      });
      // **The rule, in a status rather than a 500.** A deferral with no date is
      // "in the future", which is how a flake becomes permanent — the same rule
      // the ledger enforces on a debt row.
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { details?: { code?: string } } };
      expect(body.error?.details?.code).toBe('INVALID_DEFERRAL');
    } finally {
      await client.close();
    }
  });

  it('accepts a deferral with a date', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const response = await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: null,
        verdict: 'deferred',
        deferUntil: '2026-12-01T00:00:00.000Z',
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { deferUntil: string | null } };
      expect(body.decision.deferUntil).toBe('2026-12-01T00:00:00.000Z');
    } finally {
      await client.close();
    }
  });

  it('defaults to open, and an open record has no decision time', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const response = await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: 'e2e:platform',
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        decision: { verdict: string; decidedAt: string | null };
      };
      expect(body.decision.verdict).toBe('open');
      // A record that starts accepted would hide something nobody decided, and
      // writing the record time as the decision time is how a queue lies about
      // its own contents.
      expect(body.decision.decidedAt).toBeNull();
    } finally {
      await client.close();
    }
  });

  it('refuses a write that names no finding', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const response = await post(app, `/api/v1/projects/${project.id}/decisions`, {
        cell: 'e2e:frontend',
      });
      expect(response.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('refuses a decision about a project that does not exist', async () => {
    const { app, client } = await withDecisions();
    try {
      const response = await post(
        app,
        '/api/v1/projects/99999999-9999-4999-8999-999999999999/decisions',
        { findingId: FINDING, cell: null },
      );
      expect(response.status).toBe(404);
    } finally {
      await client.close();
    }
  });

  it('refuses a deferral whose date is not an instant, at the boundary', async () => {
    // **The one field whose malformed value was fatal in one store and merely
    // unparseable in the other:** the SQL store's `optionalDate` turned
    // `'next tuesday'` into `null`, which tripped the CHECK constraint as a raw
    // Postgres error → 500, while the in-memory store kept the string and answered
    // 200 with a body the contract's own `z.iso.datetime()` refuses. One refusal at
    // the seam, in the validation both stores call, replaces both.
    const { app, project, client } = await withDecisions();
    try {
      const response = await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: 'flaky-decision',
        cell: 'e2e:frontend',
        verdict: 'deferred',
        deferUntil: 'next tuesday',
      });
      expect(response.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('keeps a deferral date when the patch names only a verdict', async () => {
    // The route sends `null` for every field a JSON body omits, so "not named" and
    // "cleared" look identical at the boundary unless the store says which is
    // which. The SQL store used to write an explicit NULL and delete the date.
    const { app, project, client } = await withDecisions();
    try {
      await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: 'flaky-decision',
        cell: 'e2e:frontend',
        verdict: 'deferred',
        deferUntil: '2026-10-20T00:00:00.000Z',
        note: 'retry when the flake is fixed',
        ownerId: 'reviewer-1',
      });
      const patched = await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: 'flaky-decision',
        cell: 'e2e:frontend',
        verdict: 'fixed',
      });
      expect(patched.status).toBe(200);
      const body = (await patched.json()) as {
        decision: {
          verdict: string;
          deferUntil: string | null;
          note: string | null;
          ownerId: string | null;
        };
      };
      expect(body.decision.verdict).toBe('fixed');
      expect(body.decision.deferUntil).toBe('2026-10-20T00:00:00.000Z');
      expect(body.decision.note).toBe('retry when the flake is fixed');
      expect(body.decision.ownerId).toBe('reviewer-1');
    } finally {
      await client.close();
    }
  });

  it('answers honestly when no decision store is configured', async () => {
    // The store is injected, so an install without one records nothing. A 501
    // rather than an empty 200: "nothing to read" and "I cannot read" are
    // different answers, and the honest one is the second.
    const { client, db } = await migrated();
    try {
      const created = await post(harness(db), '/api/v1/projects', {
        name: 'Service',
        slug: 'svc',
        repoPath: '/repos/svc',
      });
      const { project } = (await created.json()) as { project: { id: string } };
      const response = await post(harness(db), `/api/v1/projects/${project.id}/decisions`, {
        findingId: FINDING,
        cell: null,
      });
      // The boundary maps `NOT_CONFIGURED` to 503, which is the honest answer:
      // this deployment can record nothing, and its capability is absent rather
      // than broken. A 200 with an empty body would say "you have no verdicts".
      expect(response.status).toBe(503);
    } finally {
      await client.close();
    }
  });
});

/**
 * The loop's two reads, as the daily screen asks them.
 *
 * The store's ordering rules are pinned against both implementations in
 * `decision-store-parity.test.ts`; these are the route-level proofs, where a
 * predicate that was parsed and then dropped would answer "nothing is waiting
 * on you" about a question whose filter never reached the store.
 */
describe('reading decisions with a predicate', () => {
  async function withDecisions(): Promise<{
    app: ReturnType<typeof harness>;
    project: { id: string };
    client: { close: () => Promise<void> };
  }> {
    const { client, db } = await migrated();
    const store = new InMemoryDecisionStore();
    const created = await post(harnessWithDecisions(db, store), '/api/v1/projects', {
      name: 'Service',
      slug: 'svc',
      repoPath: '/repos/svc',
    });
    const { project } = (await created.json()) as { project: { id: string } };
    return {
      app: harnessWithDecisions(db, store),
      project,
      client: client as unknown as { close: () => Promise<void> },
    };
  }

  /** One decision written through the route, so the test drives the real write. */
  async function decide(
    app: ReturnType<typeof harness>,
    projectId: string,
    input: { findingId: string; cell: string | null; verdict: string; ownerId?: string },
  ): Promise<void> {
    await post(app, `/api/v1/projects/${projectId}/decisions`, input);
  }

  it('answers "what is waiting on me" with one owner’s open rows, oldest first', async () => {
    const { app, project, client } = await withDecisions();
    try {
      await decide(app, project.id, {
        findingId: 'gap-queue',
        cell: 'e2e:frontend',
        verdict: 'open',
        ownerId: 'reviewer-1',
      });
      await decide(app, project.id, {
        findingId: 'hollow-tests',
        cell: 'unit:backend',
        verdict: 'open',
        ownerId: 'reviewer-1',
      });
      // Two rows the predicate must not answer with: another owner's work, and
      // this owner's work that is already closed.
      await decide(app, project.id, {
        findingId: 'pass-rate',
        cell: null,
        verdict: 'open',
        ownerId: 'reviewer-2',
      });
      await decide(app, project.id, {
        findingId: 'flaky-decision',
        cell: 'e2e:frontend',
        verdict: 'fixed',
        ownerId: 'reviewer-1',
      });

      const response = await app.request(
        `/api/v1/projects/${project.id}/decisions?verdict=open&ownerId=reviewer-1`,
      );
      expect(response.status).toBe(200);
      const list = (await response.json()) as {
        decisions: Array<{ findingId: string; verdict: string; ownerId: string | null }>;
      };
      // **The sequence, not the set.** A queue ordered by recency would put the
      // row that has waited longest at the bottom, which is a screen answering
      // a different question than the one asked.
      expect(list.decisions.map((row) => row.findingId)).toEqual(['gap-queue', 'hollow-tests']);
      expect(list.decisions.every((row) => row.verdict === 'open')).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('answers "what did I decide" newest first, across a span or an instant', async () => {
    const { app, project, client } = await withDecisions();
    try {
      await decide(app, project.id, {
        findingId: 'gap-queue',
        cell: 'e2e:frontend',
        verdict: 'fixed',
        ownerId: 'reviewer-1',
      });
      await decide(app, project.id, {
        findingId: 'flaky-decision',
        cell: 'e2e:frontend',
        verdict: 'accepted',
        ownerId: 'reviewer-1',
      });
      await decide(app, project.id, {
        findingId: 'hollow-tests',
        cell: 'unit:backend',
        verdict: 'fixed',
        ownerId: 'reviewer-2',
      });

      const spanned = await app.request(
        `/api/v1/projects/${project.id}/decisions?decidedBy=reviewer-1&since=7d`,
      );
      expect(spanned.status).toBe(200);
      const list = (await spanned.json()) as { decisions: Array<{ findingId: string }> };
      // `decidedBy` is `ownerId` spelled for this question, so reviewer-2's row
      // is absent and the newest decision is first.
      expect(list.decisions.map((row) => row.findingId)).toEqual(['flaky-decision', 'gap-queue']);

      // The same question with the window as an instant, which is the other
      // spelling `since` accepts — both resolve to the one shape the store takes.
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const instant = await app.request(
        `/api/v1/projects/${project.id}/decisions?decidedBy=reviewer-1&since=${encodeURIComponent(since)}`,
      );
      expect(instant.status).toBe(200);
      const same = (await instant.json()) as { decisions: Array<{ findingId: string }> };
      expect(same.decisions.map((row) => row.findingId)).toEqual(['flaky-decision', 'gap-queue']);
    } finally {
      await client.close();
    }
  });

  it('refuses a verdict the vocabulary does not contain, rather than answering nothing', async () => {
    // A filter that matches nothing and a filter that was misspelled both return
    // `[]`, and only one of them is an answer about the work.
    const { app, project, client } = await withDecisions();
    try {
      const response = await app.request(
        `/api/v1/projects/${project.id}/decisions?verdict=wontfix`,
      );
      expect(response.status).toBe(400);
    } finally {
      await client.close();
    }
  });

  it('refuses a `since` that is neither an instant nor a span', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const response = await app.request(
        `/api/v1/projects/${project.id}/decisions?decidedBy=reviewer-1&since=last+tuesday`,
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { message?: string } };
      expect(body.error?.message).toContain('since');
    } finally {
      await client.close();
    }
  });

  it('refuses a span so large the instant cannot exist, rather than crashing', async () => {
    // **`999999999999d` is past the representable epoch range, and
    // `new Date(...).toISOString()` throws a `RangeError` outside the
    // `DomainError` mapping** — which is how this answered a raw 500 where the
    // route's own comment promised a 400. A span is capped before the arithmetic.
    const { app, project, client } = await withDecisions();
    try {
      const response = await app.request(
        `/api/v1/projects/${project.id}/decisions?decidedBy=reviewer-1&since=999999999999d`,
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { message?: string } };
      expect(body.error?.message).toContain('since');
    } finally {
      await client.close();
    }
  });
});

/**
 * The timeline endpoint: verdicts by week, by owner, and what has none.
 *
 * **Parsed with the contract, not cast.** The response is checked through
 * `DecisionTimelineSchema` because this is the first endpoint whose shape a
 * screen will read field by field: an `owners` entry the client does not expect
 * is a render that throws, and a schema parse is where that is caught.
 */
describe('reading the decision timeline', () => {
  async function withDecisions(): Promise<{
    app: ReturnType<typeof harness>;
    project: { id: string };
    client: { close: () => Promise<void> };
  }> {
    const { client, db } = await migrated();
    const store = new InMemoryDecisionStore();
    const created = await post(harnessWithDecisions(db, store), '/api/v1/projects', {
      name: 'Service',
      slug: 'svc',
      repoPath: '/repos/svc',
    });
    const { project } = (await created.json()) as { project: { id: string } };
    return {
      app: harnessWithDecisions(db, store),
      project,
      client: client as unknown as { close: () => Promise<void> },
    };
  }

  it('serves weeks, owners and the findings nobody has decided', async () => {
    const { app, project, client } = await withDecisions();
    try {
      await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: 'flaky-decision',
        cell: 'e2e:frontend',
        verdict: 'fixed',
        ownerId: 'reviewer-1',
      });
      await post(app, `/api/v1/projects/${project.id}/decisions`, {
        findingId: 'pass-rate',
        cell: null,
        verdict: 'open',
      });

      const response = await app.request(
        `/api/v1/projects/${project.id}/decisions/timeline?weeks=2&findingIds=flaky-decision,pass-rate,zero-caps-mean`,
      );
      expect(response.status).toBe(200);
      const timeline = DecisionTimelineSchema.parse(await response.json());

      // Two weeks, and the current one carries the one verdict that was decided.
      expect(timeline.window.weeks).toBe(2);
      expect(timeline.weeks).toHaveLength(2);
      expect(timeline.weeks[1]?.counts['fixed']).toBe(1);
      // **An `open` row is not a verdict in any week.** It has no decision time
      // — it is waiting, not history — and counting it would inflate a week
      // with rows nobody has called.
      expect(timeline.weeks[1]?.counts['open']).toBe(0);
      expect(timeline.owners).toEqual([{ ownerId: 'reviewer-1', decided: 1 }]);
      // The undecided set is the finding nobody recorded: `pass-rate` has a row
      // (open is a verdict the vocabulary knows), so it is the inbox's question
      // rather than the timeline's.
      expect(timeline.undecided).toEqual({ count: 1, findingIds: ['zero-caps-mean'] });
    } finally {
      await client.close();
    }
  });

  it('names a default window when the caller asks for none', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const response = await app.request(`/api/v1/projects/${project.id}/decisions/timeline`);
      expect(response.status).toBe(200);
      const timeline = DecisionTimelineSchema.parse(await response.json());
      expect(timeline.window.weeks).toBe(DECISION_TIMELINE_WEEKS);
      expect(timeline.weeks).toHaveLength(DECISION_TIMELINE_WEEKS);
      // No findings named, so the undecided set is an answer about an empty set
      // — which is why the route documents that it is not a claim that nothing
      // is undecided.
      expect(timeline.undecided).toEqual({ count: 0, findingIds: [] });
    } finally {
      await client.close();
    }
  });

  it('refuses a window it cannot serve, and 404s a project that does not exist', async () => {
    const { app, project, client } = await withDecisions();
    try {
      const weeks = await app.request(`/api/v1/projects/${project.id}/decisions/timeline?weeks=0`);
      expect(weeks.status).toBe(400);
      const missing = await app.request(
        '/api/v1/projects/99999999-9999-4999-8999-999999999999/decisions/timeline',
      );
      expect(missing.status).toBe(404);
    } finally {
      await client.close();
    }
  });
});
