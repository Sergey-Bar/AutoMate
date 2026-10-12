import { Hono, type Context } from 'hono';
import { z, ZodError } from 'zod/v4';
import {
  CopilotQuestionSchema,
  RunStartBodySchema,
  RunStopBodySchema,
  type RunCommand,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { qaScore, stopRun } from '../services/qa-score-service.js';
import { answer } from '../services/copilot-service.js';
import { diffScores, probeToolchain, ProjectProfilePatchSchema } from '@automate/projects';
import { DecisionError } from '../execution/decision-store.js';
import type { DecisionStore } from '../execution/decision-store.js';
import { DECISION_TIMELINE_WEEKS, DECISION_VERDICTS } from '@automate/db';
import type { DecisionVerdict } from '@automate/db';
import {
  ensureWorkspace,
  getProject,
  listCommands,
  listProjects,
  refreshProject,
  updateProjectProfile,
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
  /**
   * The store a verdict about a derived finding is recorded in, and read back
   * from. Injected rather than constructed, for the same reason the stores below
   * are: an install with no database records nothing, and a test drives it with
   * the in-memory store in one line.
   */
  decisionStore?: DecisionStore;
  startRun: (input: {
    projectId: string;
    commandId: string;
    command: RunCommand;
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
   * Edits a project's stored profile.
   *
   * **The endpoint the documentation site already promises** ("correcting a
   * detected command is a profile edit — `automate.config.json` or `PATCH
   * /projects/:id`") and that nothing served. An operator correcting a
   * misdetection from the hosted install has no shell and no write access to the
   * repository, so the profile was not editable through the product.
   *
   * The body is parsed through `ProjectProfilePatchSchema`, so a key this build
   * does not understand is a 422 rather than a silent no-op on a field a reader
   * believes they changed. What it may change is what the file may change — see
   * `updateProjectProfile`, which merges through the same rule.
   */
  app.patch('/api/v1/projects/:id', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    // `safeParse` against the patch schema, so a key this build does not know is a
    // 422 with the message rather than a silent no-op on a field a reader believes
    // they changed — the same discipline `RunStartBodySchema` gets below.
    const parsed = ProjectProfilePatchSchema.safeParse(await readJson(context));
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: ErrorCode.INVALID_REQUEST_BODY,
            message: 'The profile edit is not a shape this build understands',
            details: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
        422,
      );
    }
    const updated = await updateProjectProfile(options, projectId, parsed.data);
    // The commands come back with the profile, for the same reason `POST` returns
    // them: the edit's whole purpose is to change what can be run, so the answer
    // is what can now be run.
    return context.json({
      project: updated,
      commands: await listCommands(options, updated.id),
    });
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
        command,
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
   * The toolchain probe: what this repository's QA stack actually is.
   *
   * ## The browser cannot ask this, and the browser used to pretend it could
   *
   * The cockpit carried a hand-written ten-path list and *assumed* the repository
   * had those files, so "your stack" was whatever the client imagined. The probe
   * reads the repository — through the same `RepositoryView` port the detector
   * uses, so it is injectable and testable — and answers per tool with the path or
   * manifest entry that proved it.
   *
   * **Every detection carries its evidence, and an undetected tool carries none.**
   * A row with a fabricated path would be worse than a missing row, because the
   * coverage figure the screen prints is computed from this join: a tool nobody
   * can check is a number nobody can trust. `analyzeStack` turns these detections
   * into the registry join, and the registry lives in `@automate/projects` so the
   * API and the browser read one list of fifty tools.
   *
   * The working directory is the repository root and the environment is empty:
   * an override here would be a claim about the runner's environment, which has
   * its own endpoint and is not the repository's answer.
   */
  app.get('/api/v1/projects/:id/toolchain', async (context) => {
    const projectId = context.req.param('id');
    const project = await getProject(options, projectId);
    // `repoPath` is `min(1)` on the registration *input*, but the stored type is
    // `string | null` — the column is nullable, so a row can exist without a path
    // (a legacy row, or a write from a path that did not validate). The guard is
    // reachable, the refusal is honest, and the registration invariant asserted
    // in `projects.test.ts` is what keeps it rare.
    if (project.repoPath === null) {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST,
        'This project has no repository path, so its toolchain cannot be probed',
      );
    }
    const detections = await probeToolchain(options.viewFor(project.repoPath), {});
    return context.json({ projectId, detections });
  });

  /**
   * The provenance diff, between two readings of the same project.
   *
   * ## `since` is an **instant**, and it is a real filter
   *
   * There is no stored score to diff against, and that is deliberate — `score()` is a
   * pure derivation and a `health_scores` table would be a fourth blocking number
   * that has to agree with the coverage floor, the performance threshold and the gate
   * tier. So the caller passes the instant to recompute the earlier reading from, and
   * the **current** reading is always recomputed.
   *
   * `readScoreInputs` cuts both reads at that instant (`startedAt <= at`), so the two
   * ends are two windows rather than one window counted twice. It used to do not: the
   * read had no time parameter at all, `at` was a label, and this endpoint subtracted
   * a number from itself on every request. The comment that made that survive review
   * — "two readings of the same instant would produce an empty diff, which is a true
   * answer rather than an error" — was **the claim, and it was wrong twice**: the two
   * readings were never of the same instant, and an empty diff over a row set compared
   * with itself is not an answer about the code.
   *
   * `diffScores` now refuses that case, and the refusal is surfaced as a 400 rather
   * than swallowed. A client that asks for a window the repository has no rows in gets
   * told to pick a different `since`; it does not get a well-formed `ScoreDelta` whose
   * every contribution cites evidence for a change that never happened.
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
    const now = new Date().toISOString();
    const before = await qaScore(options, projectId, since);
    const after = await qaScore(options, projectId, now);
    try {
      return context.json(diffScores(before, after));
    } catch (failure) {
      // **A schema failure is not a refusal.** `diffScores` parses its own output
      // through `ScoreDeltaSchema`, so a `ZodError` here means the product computed
      // something the contract does not allow — a server fault, and reporting it as
      // `400 INVALID_REQUEST` would tell the caller their request was wrong when the
      // server is. It goes to the boundary untouched.
      if (failure instanceof ZodError) throw failure;
      // Everything else `diffScores` throws is one of its three refusals: a
      // cross-project diff, a backwards one, or a `since` that selects the same rows.
      // All three are the caller's mistake, so all three are 4xx carrying the
      // function's own sentence rather than a paraphrase of it.
      throw new DomainError(
        ErrorCode.INVALID_REQUEST,
        failure instanceof Error ? failure.message : String(failure),
      );
    }
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

  /**
   * The decision inbox for one project — the loop, read back.
   *
   * ## What this route is for
   *
   * Everything above measures. This is where a human's verdict about what was
   * measured is written and read, and it is what turns the insights screen from a
   * dashboard into a work queue: the console derives a finding, the screen shows
   * it, and a tester closes it with a verdict that names them and, for a
   * deferral, a date.
   *
   * **A `POST` with no body records the verdict stated in the path** — no verdict
   * means `open` — so the common case (a tester clicking "I'll take this") is the
   * smallest possible write, and the failure wins are narrow: no unknown verdicts,
   * no undated deferrals. Both are refused at the store, from the one rule shared
   * with the in-memory store, and the parity suite is what proves it.
   */
  app.post('/api/v1/projects/:id/decisions', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    const body = await readJson(context);
    const input = asRecord(body);
    if (options.decisionStore === undefined) {
      throw new DomainError(
        ErrorCode.NOT_CONFIGURED,
        'This install has no decision store configured, so a verdict cannot be recorded',
      );
    }
    const findingId = typeof input['findingId'] === 'string' ? input['findingId'] : null;
    if (findingId === null) {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        'A decision names the finding it is about',
      );
    }
    const verdict = typeof input['verdict'] === 'string' ? input['verdict'] : 'open';
    const cell = typeof input['cell'] === 'string' ? input['cell'] : null;
    const recorded = await options.decisionStore
      .record(
        projectId,
        {
          findingId,
          cell,
          verdict: verdict as DecisionVerdict,
          ownerId: typeof input['ownerId'] === 'string' ? input['ownerId'] : null,
          note: typeof input['note'] === 'string' ? input['note'] : null,
          deferUntil: typeof input['deferUntil'] === 'string' ? input['deferUntil'] : null,
        },
        options.workspaceId,
      )
      .catch((error: unknown) => {
        // The store's refusal, in the API's own shape. The store already named the
        // rule; the boundary maps it to a status so a caller can act on it rather
        // than parsing English out of a 500.
        if (error instanceof DecisionError) {
          throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, error.message, {
            details: { code: error.code },
          });
        }
        throw error;
      });
    return context.json({ decision: recorded }, 200);
  });

  /**
   * The decisions for one project, and the two questions the loop asks daily.
   *
   * ## Two predicates, and each names the index behind it
   *
   * `?verdict=open&ownerId=<me>` is *what is waiting on me*, and it reads
   * `decision_records_workspace_owner_idx` in index order — the composite is
   * `(workspace_id, owner_id, verdict)` over open rows. `?decidedBy=<me>&since=7d`
   * is *what I decided*, and it reads
   * `decision_records_workspace_verdict_idx` on `decided_at`. A predicate with no
   * index behind it would be the loop running a sequential scan on every page
   * load, which is why there are three query fields and not eight.
   *
   * **`decidedBy` is `ownerId` spelled for the question it answers.** The store
   * has one column, because one person owns a verdict whether it is waiting or
   * recorded; the two spellings are the route's, and both land on it.
   *
   * ## `since` is an instant or a span, and it is resolved here
   *
   * An ISO instant is passed through. A span — `7d`, `12h` — is resolved against
   * *this* request's clock and handed down as an absolute instant, so the store
   * takes one shape and the URL a screen writes is the one a human would type.
   * Anything else is a 400 rather than a silently empty window: a `since` that
   * parsed to nothing would answer "you decided nothing" about a question whose
   * window was never named.
   *
   * ## With no predicate at all, the order is the project list's
   *
   * Open first and then by recency, unchanged from before the predicates
   * existed. A filtered read may reverse that order — `since` reads newest
   * first — which is why an unfiltered one does not silently inherit it.
   */
  app.get('/api/v1/projects/:id/decisions', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    if (options.decisionStore === undefined) {
      throw new DomainError(
        ErrorCode.NOT_CONFIGURED,
        'This install has no decision store configured, so there is nothing to read',
      );
    }

    const verdict = context.req.query('verdict');
    if (verdict !== undefined && !(DECISION_VERDICTS as readonly string[]).includes(verdict)) {
      // An unknown verdict is refused rather than treated as "no rows": a
      // filter that matches nothing and a filter that was misspelled both
      // return `[]`, and only one of them is an answer about the work.
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        `"${verdict}" is not a verdict this product knows`,
      );
    }
    const ownerId = context.req.query('ownerId') ?? context.req.query('decidedBy');
    const since = resolveSince(context.req.query('since'));

    if (verdict === undefined && ownerId === undefined && since === undefined) {
      const decisions = await options.decisionStore.listForProject(projectId, options.workspaceId);
      return context.json({ decisions }, 200);
    }

    const decisions = await options.decisionStore.listFiltered(projectId, options.workspaceId, {
      ...(verdict === undefined ? {} : { verdict: verdict as DecisionVerdict }),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(since === undefined ? {} : { since }),
    });
    return context.json({ decisions }, 200);
  });

  /**
   * The decision timeline: verdicts by week, by owner, and what has none.
   *
   * ## The findings are the caller's, and that is the honest split
   *
   * The derived findings are the output of a pure engine — `lib/findings.ts` on
   * the screen — and not a table, so this endpoint cannot know them and does not
   * pretend to. The caller names the ids it derived in `findingIds`, and the
   * store answers which of them have no row. **Name none and the undecided set
   * is an answer about an empty set**, not a claim that nothing is undecided;
   * the weeks and the owners are the store's own and are always complete.
   *
   * The window is read at one instant, threaded in rather than stamped twice, so
   * a response whose weeks and owners disagree about which week it is cannot be
   * produced.
   */
  app.get('/api/v1/projects/:id/decisions/timeline', async (context) => {
    const projectId = context.req.param('id');
    await getProject(options, projectId);
    if (options.decisionStore === undefined) {
      throw new DomainError(
        ErrorCode.NOT_CONFIGURED,
        'This install has no decision store configured, so there is no timeline to read',
      );
    }
    const weeksParam = context.req.query('weeks');
    // The default window is named here rather than left to the store, so the
    // route's own doc comment and the response's `window.weeks` cannot disagree
    // about how much history a screen gets when it asks for none.
    const weeks =
      weeksParam === undefined || weeksParam === ''
        ? DECISION_TIMELINE_WEEKS
        : Number.parseInt(weeksParam, 10);
    if (weeks !== undefined && (!Number.isFinite(weeks) || weeks < 1 || weeks > 52)) {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        'weeks must be a whole number of weeks between 1 and 52',
      );
    }
    const findingIds = (context.req.query('findingIds') ?? '')
      .split(',')
      .map((findingId) => findingId.trim())
      .filter((findingId) => findingId.length > 0);

    const timeline = await options.decisionStore.timeline(projectId, options.workspaceId, {
      findingIds,
      weeks,
      at: new Date().toISOString(),
    });
    return context.json(timeline, 200);
  });

  return app;
}

/**
 * The `since` a caller wrote, as the instant the store predicates on.
 *
 * ## A span is resolved here, and only here
 *
 * The store takes an instant — one shape, one comparison, no clock of its own.
 * So a relative window is the route's spelling: `7d` is what a human means by
 * "what I decided this week", and a URL that must carry
 * `2026-10-05T00:00:00.000Z` to ask it is a URL nobody writes twice. The
 * resolution is against *this request's* clock, which is the only clock a
 * request has.
 *
 * ## Anything else is refused rather than parsed loosely
 *
 * `Date.parse` accepts `October 5, 2026` and `2026-10-05` and half a dozen
 * other spellings, and a `since` that silently parsed to midnight when the
 * caller meant an instant is a window that differs by hours from the one they
 * asked for. So: an ISO 8601 instant, a `Nd`/`Nh` span, or a 400 naming both.
 */

/** How far back a `since` span may reach, in days. */
const SPAN_DAYS_CAP = 3650;

function resolveSince(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;

  const span = /^(\d+)([hd])$/u.exec(raw);
  if (span !== null) {
    const amount = Number.parseInt(span[1] ?? '0', 10);
    const unitMs = span[2] === 'd' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    const spanDays = span[2] === 'd' ? amount : amount / 24;
    // **A span beyond the cap is refused, not clamped.** `Date.now() - amount *
    // unitMs` leaves the representable epoch range at roughly 100,000,000 days,
    // and `toISOString()` then throws a `RangeError` outside the `DomainError`
    // mapping — so a URL with one extra digit answered a raw 500 where the route
    // promised a 400. Clamping it to ten years instead would silence the crash
    // and answer a *different question* than the one asked, which is the same sin
    // as `Date.parse` accepting "October 5, 2026". Ten years of history is past
    // anything a decision window means, and a caller who wants more names an
    // instant.
    if (spanDays > SPAN_DAYS_CAP) {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        `since: a span longer than ${String(SPAN_DAYS_CAP)}d is not a window; name an ISO instant instead`,
      );
    }
    return new Date(Date.now() - amount * unitMs).toISOString();
  }

  // Two tests rather than one pattern, for the reason `isIsoInstant` states: a
  // fractional-seconds group inside an optional group is the nested quantifier
  // `security/detect-unsafe-regex` refuses. This is that helper, exported from the
  // store's module precisely so a second copy of a date shape cannot exist.
  const head = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(raw);
  const offset = /(?:Z|[+-]\d{2}:\d{2})$/u.test(raw);
  if (!head || !offset) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      'since must be an ISO instant (e.g. 2026-10-05T00:00:00.000Z) or a span (7d, 12h)',
    );
  }
  const at = Date.parse(raw);
  if (Number.isNaN(at)) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      'since must be an ISO instant (e.g. 2026-10-05T00:00:00.000Z) or a span (7d, 12h)',
    );
  }
  return new Date(at).toISOString();
}
