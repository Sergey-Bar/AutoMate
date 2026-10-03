import { Hono, type Context } from 'hono';
import { z } from 'zod/v4';
import {
  CopilotQuestionSchema,
  RunStartBodySchema,
  RunStopBodySchema,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { qaScore, stopRun } from '../services/qa-score-service.js';
import { answer } from '../services/copilot-service.js';
import { diffScores } from '@automate/projects';
import {
  ensureWorkspace,
  getProject,
  listCommands,
  listProjects,
  refreshProject,
  registerProject,
  type ProjectRegistryServiceOptions,
} from '../services/project-registry-service.js';

/**
 * The project registry and the derived QA score, as one route group.
 *
 * ## Nothing here accepts an executable
 *
 * `POST /projects/:id/run.start` takes a **command id**, resolved server-side
 * against the stored profile. There is deliberately no body field for an argv: a
 * body that could carry one would make the typed command registry advisory, because
 * a caller could send any executable and the registry would be consulted only to be
 * overridden. Correcting a detected command is a *profile edit* — `automate.config.json`
 * or `PATCH /projects/:id` — which is reviewable, version-controlled, and says why.
 *
 * ## Every number is served with its limiter
 *
 * `GET /qa/score` returns `cappedBy` and `cappingValue` as required fields. A total
 * from a weighted geometric mean cannot be diluted by a zero, and for exactly that
 * reason it cannot be diagnosed either; a client rendering the total without the term
 * that limited it is showing an arithmetic score's worth of information from a
 * geometric formula, and the reader has no reason to distrust it.
 */
export interface ProjectsRouteOptions extends ProjectRegistryServiceOptions {
  /** Starts a run. Injected so the routes have no database and no queue in them. */
  startRun: (input: {
    projectId: string;
    commandId: string;
    idempotencyKey: string;
    timeoutMs?: number;
  }) => Promise<{ runId: string; jobId: string; phase: string }>;
}

const RegisterProjectBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(64)
    // A slug becomes a directory name in some installs and a URL segment in others.
    // Restricting it here means no caller has to sanitise it downstream, and a slug
    // that could carry `..` or a shell metacharacter is one more thing to defend
    // against at every use.
    .regex(/^[a-z0-9][a-z0-9._-]*$/u),
  /** Absolute path on the runner host. Never a remote URL: the runner spawns in it. */
  repoPath: z.string().min(1),
});

/**
 * A JSON body, or `null` when it is not one.
 *
 * `context.req.json()` **rejects** on a malformed body, and a route that only
 * throws a `DomainError` would surface that rejection to the app's error handler as
 * a 500 — telling an operator that their request was our fault when they sent one
 * byte of punctuation short of JSON. Returning `null` instead lets the Zod parse
 * fail and answer 400, which is what a malformed request is.
 *
 * The alternative — a `try`/`catch` per handler — was what this file had before, and
 * it was the reason this bug survived: four handlers, four `catch`es, and the one
 * that mattered was in a handler nobody had exercised.
 */
async function readJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

/** A parsed body spread into an object literal, so `null` does not throw. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function createProjectsRoutes(options: ProjectsRouteOptions): Hono {
  const app = new Hono();

  app.post('/api/v1/projects', async (context) => {
    const parsed = RegisterProjectBodySchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'Invalid project',
            details: parsed.error.issues,
          },
        },
        400,
      );
    }
    await ensureWorkspace(options);
    const project = await registerProject(options, parsed.data);
    // `201` with a `Location`: the runnable commands come from the same response so
    // a client does not need a second round trip to learn what it just registered.
    return context.json({ project, commands: project.profile.commands }, 201);
  });

  app.get('/api/v1/projects', async (context) => {
    return context.json({ projects: await listProjects(options) });
  });

  app.get('/api/v1/projects/:id', async (context) => {
    const project = await getProject(options, context.req.param('id'));
    return context.json({ project, commands: await listCommands(options, project.id) });
  });

  /**
   * Re-runs detection against the repository on disk.
   *
   * A stored profile is a **proposal from whenever the detector last ran**, and a
   * profile written by an older detector must never be read under newer rules. So
   * this re-reads the manifests and rewrites the proposal rather than echoing the
   * stored one back — which is also what makes a changed `package.json` show up
   * without anyone re-registering the project.
   */
  app.post('/api/v1/projects/:id/detect', async (context) => {
    // `refreshProject`, not `registerProject`: re-registering with the project's own
    // slug collides with the row it is meant to update, so the endpoint answered 422
    // for every project, always — and this is the button a reader presses after
    // changing their `package.json`.
    const refreshed = await refreshProject(options, context.req.param('id'));
    return context.json(refreshed);
  });

  app.get('/api/v1/projects/:id/commands', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    return context.json({ commands: await listCommands(options, projectId) });
  });

  app.post('/api/v1/projects/:id/run.start', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const parsed = RunStartBodySchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'Invalid run request',
            details: parsed.error.issues,
          },
        },
        400,
      );
    }
    // Resolved server-side, and a refusal is a 404 rather than a fallback: an
    // unknown command id means the client is out of date with the profile, and
    // guessing at a nearby command would run a suite the operator did not ask for.
    const commands = await listCommands(options, projectId);
    const command = commands.find((candidate) => candidate.id === parsed.data.commandId);
    if (command === undefined) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        `No command ${parsed.data.commandId} on project ${projectId}. Correct it in automate.config.json.`,
      );
    }
    return context.json(
      await options.startRun({
        projectId,
        commandId: command.id,
        idempotencyKey: parsed.data.idempotencyKey,
        timeoutMs: parsed.data.timeoutMs,
      }),
      202,
    );
  });

  app.post('/api/v1/runs/:runId/stop', async (context) => {
    const parsed = RunStopBodySchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'A stop needs a reason',
            details: parsed.error.issues,
          },
        },
        400,
      );
    }
    return context.json(
      await stopRun(
        options.db,
        options.workspaceId,
        context.req.param('runId'),
        parsed.data.reason,
      ),
    );
  });

  app.get('/api/v1/projects/:id/qa/score', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const at = context.req.query('at') ?? new Date().toISOString();
    return context.json(await qaScore(options, projectId, at));
  });

  /**
   * The gap queue, ranked.
   *
   * A separate endpoint rather than a query on the score because the two are read
   * for different decisions: the score answers "how are we", the queue answers "what
   * do I do next", and a client that has to fetch the whole matrix to render a list
   * will eventually cache the matrix and serve a stale queue.
   */
  app.get('/api/v1/projects/:id/qa/gaps', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({ gaps: score_.gaps, cappedBy: score_.cappedBy });
  });

  /** Hollow tests: green, and contributing nothing. */
  app.get('/api/v1/projects/:id/qa/hollow', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({
      cells: score_.cells
        .filter((cell) => cell.inputs.hollowFingerprints.length > 0)
        .map((cell) => ({
          cell: cell.key,
          hollowFingerprints: cell.inputs.hollowFingerprints,
          signal: cell.signal,
        })),
    });
  });

  /**
   * Flaky tests, split into the two kinds the score distinguishes.
   *
   * **Strong** is the same fingerprint on the same commit with a different outcome —
   * unambiguous. **Weak** is three or more flips across the last ten runs regardless
   * of commit — weaker evidence, and never enough to quarantine a test on its own,
   * because "this test flips" and "this test is wrong" are different claims.
   */
  app.get('/api/v1/projects/:id/qa/flaky', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({
      cells: score_.cells
        .filter((cell) => cell.inputs.flakyFingerprints.length > 0)
        .map((cell) => ({
          cell: cell.key,
          flakyFingerprints: cell.inputs.flakyFingerprints,
          flakeRate: cell.inputs.flakeRate,
          stability: cell.stability,
        })),
    });
  });

  /** The structural findings, which are reported and never scored. */
  app.get('/api/v1/projects/:id/qa/structure', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json({ findings: score_.findings });
  });

  /**
   * The provenance diff, between two readings of the same project.
   *
   * ## `since` is an **instant**, not a run id
   *
   * There is no stored score to diff against, and that is deliberate — `score()` is a
   * pure derivation and a `health_scores` table would be a fourth blocking number
   * that has to agree with the coverage floor, the performance threshold and the gate
   * tier. So the caller passes the instant to recompute the earlier reading from, and
   * the **current** reading is always recomputed. Two readings of the same instant
   * would produce an empty diff, which is a true answer rather than an error.
   *
   * `diffScores` refuses a cross-project or backwards diff, and that refusal is
   * surfaced as a 4xx rather than swallowed: a subtraction between two unrelated
   * numbers attributes one team's score drop to another team's release.
   */
  app.get('/api/v1/projects/:id/qa/score/diff', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const since = context.req.query('since');
    if (since === undefined || Number.isNaN(new Date(since).getTime())) {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        'since must be an ISO instant, e.g. ?since=2026-10-01T00:00:00.000Z',
      );
    }
    const before = await qaScore(options, projectId, since);
    const after = await qaScore(options, projectId, new Date().toISOString());
    return context.json(diffScores(before, after));
  });

  /**
   * The copilot.
   *
   * **A derivation over the score, not a model.** Every suggestion is arithmetic on a
   * cell — `presence === 0`, `depth === 0`, a hollow fingerprint, a strong flake — so
   * the same question has the same answer every time and each one cites the row it came
   * from. `CopilotAnswerSchema` refuses a suggestion with no evidence at the boundary,
   * which is the plan's hard rule enforced where it cannot be forgotten.
   */
  app.post('/api/v1/projects/:id/copilot/answer', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const parsed = CopilotQuestionSchema.safeParse({
      projectId,
      ...asRecord(await readJson(context)),
    });
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid copilot question', {
        details: { issues: parsed.error.issues },
      });
    }
    const score_ = await qaScore(options, projectId, new Date().toISOString());
    return context.json(answer(parsed.data, score_));
  });

  return app;
}
