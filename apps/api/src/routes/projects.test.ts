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
) {
  return mounted(
    createProjectsRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      viewFor: () => view,
      startRun: async (input) => {
        started.push(input.commandId);
        return { runId: `run-${started.length}`, jobId: `job-${started.length}`, phase: 'queued' };
      },
    }),
  );
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
      const started: string[] = [];
      const runnable = mounted(
        createProjectsRoutes({
          db: db as never,
          workspaceId: 'ws-1',
          viewFor: () => literalView(NODE_REPO),
          startRun: async (input) => {
            started.push(input.commandId);
            return { runId: 'run-1', jobId: 'job-1', phase: 'queued' };
          },
        }),
      );
      const response = await post(runnable, `/api/v1/projects/${project.id}/run.start`, {
        commandId: 'node.test',
        idempotencyKey: 'k1',
      });
      expect(response.status).toBe(202);
      expect(started).toEqual(['node.test']);
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

  it('serves a provenance diff between two readings', async () => {
    const { client, app, projectId } = await registered();
    try {
      const response = await app.request(
        `/api/v1/projects/${projectId}/qa/score/diff?since=2026-10-01T00:00:00.000Z`,
      );
      expect(response.status).toBe(200);
      const delta = (await response.json()) as unknown;
      // Parsed through the **contract**, because a diff is the one payload where a
      // missing field is the difference between an explanation and a number.
      expect(ScoreDeltaSchema.safeParse(delta).success).toBe(true);
      const parsed = ScoreDeltaSchema.parse(delta);
      expect(parsed.projectId).toBe(projectId);
      expect(parsed.from).toBe('2026-10-01T00:00:00.000Z');
      // The project has never run, so both readings score zero and the diff is empty.
      // **Empty is the right answer**, and asserting it says so: a diff that listed
      // fifteen cells at `0 → 0` would bury whatever later matters.
      expect(parsed.contributions).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('refuses a diff with no `since`, because an instant is the only anchor there is', async () => {
    const { client, app, projectId } = await registered();
    try {
      // There is no stored score to diff against, and that is deliberate — a
      // `health_scores` table would be a fourth blocking number that has to agree
      // with the coverage floor, the threshold and the gate tier. So the caller
      // names the instant to recompute from, and omitting it would mean guessing
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
